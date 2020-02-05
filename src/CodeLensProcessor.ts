import * as vscode from 'vscode';
import OutputManager from './OutputManager';
import TestExplorer from './TestExplorer';

const getOmnisharp = () => vscode.extensions.getExtension('ms-vscode.csharp');

export default class CodeLensProcessor {
    private cancel = false;

    constructor(
        private output: OutputManager,
        private testExplorer: TestExplorer,
        private suite: DerivitecTestSuiteInfo,
    ) {
        const process = this.process.bind(this);
        const handleError = this.handleError.bind(this);
        this.monitorOmnisharpInitialisation().then(process).catch(handleError);
    }

    private async monitorOmnisharpInitialisation() {
        let omnisharp = getOmnisharp();
        if (!omnisharp) {
            this.output.update('C# extension is not installed. Install and enable to apply additional CodeLens information to tests.');
            await this.waitForInstallation();
            this.processCancel();
            omnisharp = getOmnisharp();
        }
        if (omnisharp && !omnisharp.isActive) {
            this.output.update('C# extension is installed, but not yet active. Waiting for activation...');
            await this.waitForActivation();
            this.processCancel();
            omnisharp = getOmnisharp();
        }
        if (omnisharp?.isActive && 'initializationFinished' in omnisharp.exports && typeof omnisharp.exports.initializationFinished === 'function') {
            this.output.update('Waiting for Omnisharp to complete initialisation. This can take several minutes.');
            await omnisharp.exports.initializationFinished();
            this.processCancel();
            this.output.update('Omnisharp initialisation completed');
            return;
        }
        throw 'An unexpected error occurred while processing CodeLens information.';
    }

    private waitForInstallation() {
        return new Promise((resolve) => {
            vscode.extensions.onDidChange(() => {
                if (getOmnisharp()) resolve();
            })
        });
    }

    private waitForActivation() {
        return new Promise((resolve) => {
            const intervalUid = setInterval(() => {
                const omnisharp = getOmnisharp();
                if (omnisharp && omnisharp.isActive) {
                    clearInterval(intervalUid);
                    resolve();
                }
            }, 10000);
        });
    }

    private async process() {
        this.output.update('Processing CodeLens data');
        const stopLoader = this.output.loader();
        const finish = this.testExplorer.load();
        try {
            await Promise.all(this.suite.children.map(this.processItem.bind(this)));
            finish.pass(this.suite);
            stopLoader();
            this.output.update('CodeLens symbols updated');
        } catch (e) {
            finish.fail(e);
            stopLoader();
            this.handleError(e);
        }
    }

    private async processItem(item: DerivitecTestSuiteInfo | DerivitecTestInfo) {
        const symbols = await vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', item.label) as vscode.SymbolInformation[];
        this.processCancel();
        if (symbols.length > 0) {
            const symbol = symbols[0];
            item.file = symbol.location.uri.fsPath;
            item.line = symbol.location.range.start.line;
        }
        if ('children' in item && item.children.length > 0) await Promise.all(item.children.map(this.processItem.bind(this)));
}

    private processCancel() {
        if (this.cancel) throw 'Processing cancelled.';
    }

    private handleError(err: Error | string) {
        this.output.update(`[CodeLens] Error: ${err}`);
    }

    dispose() {
        this.cancel = true;
    }
}