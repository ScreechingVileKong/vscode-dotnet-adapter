import Command from './Command';
import * as vscode from 'vscode';
import { Log } from 'vscode-test-adapter-util';
import * as fs from 'fs';

import { ConfigManager } from "./configManager";
import ProcessPool from './ProcessPool';
import OutputManager, { Loaded } from './OutputManager';

export class TestDiscovery {
	private readonly configManager: ConfigManager;

    private NodeById =
        new Map<string, DerivitecSuiteContext | DerivitecTestContext>();

	private Loadingtest: Command | undefined;

	private loadStatus: Loaded;

    private SuitesInfo: DerivitecTestSuiteInfo = {
		type: 'suite',
		id: 'root',
		label: '.Net Core',
		children: [],
		sourceDll: 'root'
	};

	private watchers?: vscode.FileSystemWatcher[];

    constructor(
        private readonly workspace: vscode.WorkspaceFolder,
        private readonly output: OutputManager,
		private readonly log: Log,
	){
		this.configManager = new ConfigManager(this.workspace, this.log);
		this.loadStatus = this.output.loaded;
    }

    public GetNode(id: string): DerivitecSuiteContext | DerivitecTestContext {
        const node = this.NodeById.get(id);
        if (!node) throw `Test node '${id}' could not be found!`
        return node;
    }

    public async Load(): Promise<DerivitecTestSuiteInfo> {
		this.log.info('Loading tests (starting)');

		this.NodeById.set(this.SuitesInfo.id, {node: this.SuitesInfo});

		await this.StopLoading();

		if (Array.isArray(this.watchers) && this.watchers.length > 0) {
			this.watchers.map(watcher => watcher.dispose());
		}

		const searchPatterns = this.configManager.get('searchpatterns');

		const searchPatternConcat = `{${searchPatterns.join(',')}}`;

		this.output.update('Searching for tests');
		const files = await this.LoadFiles(searchPatternConcat);
		this.loadStatus.loaded += files.length;
		for (const file of files) {
			try {
				this.log.info(`file: ${file} (loading)`);
				await this.SetTestSuiteInfo(file);
				this.log.info(`file: ${file} (load complete)`);
			} catch (e) {
				this.log.error(e);
				throw e;
			}
		};

		/* for (const searchPattern of searchPatterns) {
			this.UpdateOutput(`Searching for files with "${searchPattern}"`);
			const files = await this.LoadFiles(searchPattern);
			this.loadStatus.loaded += files.length;
			for (const file of files) {
				try {
					this.log.info(`file: ${file} (loading)`);
					await this.SetTestSuiteInfo(file);
					this.log.info(`file: ${file} (load complete)`);
				} catch (e) {
					this.log.error(e);
					throw e;
				}
			};
		} */

		// Create watchers
		this.watchers = searchPatterns.map(pattern => this.setupWatcher(pattern));

		if (this.SuitesInfo.children.length == 0)
		{
			const errorMsg = 'No tests found, check the SearchPattern in the extension settings.';
			this.log.error(errorMsg);
			throw errorMsg;
		}

		/* const suites = new ProcessPool(Array.from(this.NodeById).map(([key, val]) => val), 300000);
		await suites.try(async (file) => {
			let symbols;
			if (file.node.type === 'suite') {
				symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', file.node.sourceDll) as vscode.SymbolInformation[];
			} else if (file.node.type = 'test') {
				symbols = await vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', file.node.label) as vscode.SymbolInformation[];
			}
			if (!symbols || symbols.length === 0) throw 'No symbols found';
			return symbols;
		}) */

		this.output.update('Loading tests complete', true);

		this.log.info('Loading tests (complete)');
		return this.SuitesInfo;
    }


	private async StopLoading(): Promise<void> {
		if (typeof this.Loadingtest === 'undefined') return;
		this.Loadingtest.childProcess.kill();
		await this.Loadingtest.exitCode;
	}

    private async LoadFiles(searchpattern: string): Promise<string[]> {
		// global pattern for createFileSystemWatcher
		// const globr = path.resolve(this.workspace.uri.fsPath, searchpattern!);
		// relative pattern for findFiles
		const stopLoader = this.output.loader();
		const findGlob = new vscode.RelativePattern(this.workspace.uri.fsPath, searchpattern);
		const skipGlob = this.configManager.get('skippattern');
		let files: string[] = [];
		for (const file of await vscode.workspace.findFiles(findGlob, skipGlob)) {
			files.push(file.fsPath);
		}
		stopLoader();
		// if (this.WSWatcher != undefined)
		// 	this.WSWatcher.dispose();
		// this.WSWatcher = vscode.workspace.createFileSystemWatcher(globr);
		// this.addwatcher(this.WSWatcher);
		return files;
	}

    private async SetTestSuiteInfo(file: string): Promise<void> {
		const testListFile = `${file}.txt`;
		let newFile = false;
		try {
			const cacheStat = fs.statSync(testListFile);
			const fileStat = fs.statSync(file);
			if (cacheStat.mtime > fileStat.mtime) {
				this.loadStatus.addedFromCache += 1;
				this.AddtoSuite(file);
				return;
			}
		} catch(err) {
			if (err instanceof Error && err.message.indexOf('no such file')) {
				newFile = true;
				this.log.debug(`No cache file for ${testListFile}`);
			} else {
				this.log.error(`Unable to check for a cache file for ${testListFile}; Encountered: ${err}`);
			}
		}

		const args: string[] = [
			'vstest',
			file,
			'/ListFullyQualifiedTests',
			`/ListTestsTargetPath:${testListFile}`
		];
		this.log.debug(`execute: dotnet ${args.join(' ')} (starting)`);
		this.Loadingtest = new Command('dotnet', args, { cwd: this.workspace.uri.fsPath});
		this.Loadingtest.onData(data => this.output.update(data.toString()));
		try {
			const code = await this.Loadingtest.exitCode;
			this.log.debug(`execute: dotnet ${args.join(' ')} (complete)`);
			this.Loadingtest = undefined;
			this.log.info(`child process exited with code ${code}`);
			if (newFile) this.loadStatus.addedFromFile += 1;
			else this.loadStatus.updatedFromFile += 1;
			this.AddtoSuite(file);
		} catch (err) {
			this.log.error(`child process exited with error ${err}`);
			this.SuitesInfo.children.length = 0;
			if (this.Loadingtest) this.Loadingtest.childProcess.removeAllListeners();
			this.Loadingtest = undefined;
		}
    }

    private AddtoSuite(file: string) {
		this.log.info(`suite creation: ${file} (starting)`);

		const output = fs.readFileSync(`${file}.txt`).toString()
		let lines = output.split(/[\n\r]+/);

		const pathItems = file.split('/');
		const fileNamespace = pathItems[pathItems.length - 1].replace(".dll", "");

		this.ResetSuites(file);
		const fileSuite: DerivitecTestSuiteInfo = {
			type: "suite",
			id: fileNamespace,
			label: fileNamespace,
			sourceDll: file,
			children: []
		};
		this.log.info(`adding node: ${fileNamespace}`);
		this.NodeById.set(fileSuite.id, {node: fileSuite});
		this.SuitesInfo.children.push(fileSuite);

		for (const line of lines) {
			if (!line) {
				continue;
			}

			const testArray = line.split('.');
			if (testArray.length < 2) continue;
			const testName = testArray.pop()!;
			const className = testArray.pop()!;
			const namespace = line.replace(`.${className}.${testName}`, "");

			const classId = `${namespace}.${className}`;
			let classContext = this.NodeById.get(classId) as DerivitecSuiteContext;

			if(!classContext)	{
				classContext = {
					node: {
						type: 'suite',
						id: classId,
						label: className,
						sourceDll: file,
						children: []
					}
				};
				this.NodeById.set(classContext.node.id, classContext);
				fileSuite.children.push(classContext.node);
			}

			const testInfo: DerivitecTestInfo = {
				type: 'test',
				id: line,
				description: line,
				label: testName,
				sourceDll: file,
				skipped: false
			};

			this.loadStatus.added += 1;
			this.log.info(`adding node: ${line}`);
			this.NodeById.set(testInfo.id, {node: testInfo});
			classContext.node.children.push(testInfo);
		}
		this.log.info(`suite creation:: ${file} (complete)`);

	}

    	/* remove all tests of module fn from Suite */
	private ResetSuites(fileName: string) {
		let i = 0;
		for (const suite of this.SuitesInfo.children) {
			if (suite.file == fileName) {
				this.SuitesInfo.children.splice(i, 1);
			}
			i++;
		}
	}

	private setupWatcher(searchPattern: vscode.GlobPattern) {
		const watcher = vscode.workspace.createFileSystemWatcher(searchPattern);
		const add = async (uri: vscode.Uri) => {
			if (typeof this.Loadingtest !== 'undefined') await this.Loadingtest.exitCode;
			this.resetLoadStatus();
			this.loadStatus.loaded += 1;
			await this.SetTestSuiteInfo(uri.fsPath);
			this.output.update(`New tests added from ${uri.fsPath.replace(this.workspace.uri.fsPath, '')}`, true);
		}
		watcher.onDidChange(add);
		watcher.onDidCreate(add);
		watcher.onDidDelete((uri) => this.ResetSuites(uri.fsPath));
		return watcher;
	}

	private resetLoadStatus() {
		// Reset output numbers
		Object.keys(this.loadStatus).forEach((key) => Object.assign(this.loadStatus, { [key]: 0 }));
	}

}