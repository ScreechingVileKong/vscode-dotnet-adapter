import * as vscode from 'vscode';
import { TestLoadStartedEvent, TestLoadFinishedEvent, TestRunStartedEvent, TestRunFinishedEvent } from 'vscode-test-adapter-api';
import { plural } from './utilities';

type PromiseResolver = (value?: void | PromiseLike<void> | undefined) => void;

type PromiseRejecter = (reason?: any) => void;

type CompletionHandle<T> = (data: T) => void;

type CompletionHandleWithFailure<T, P> = { pass: CompletionHandle<T>, fail: CompletionHandle<P> };

const opCount = 2;
enum OP_TYPE { LOAD, RUN };

const opPriority = [OP_TYPE.RUN, OP_TYPE.LOAD];

type LoadState = 'none' | 'started' | 'finished';

export default class TestExplorer {
    private disposables: { dispose(): void }[] = [];

    private readonly testsEmitter =
        new vscode.EventEmitter<TestLoadStartedEvent | TestLoadFinishedEvent>();

	private readonly testStatesEmitter = new vscode.EventEmitter<TestRunStartedEvent |
        TestRunFinishedEvent | TestSuiteEvent | TestEvent>();

    private readonly autorunEmitter = new vscode.EventEmitter<void>();

    private jobQueues: Slot[][] = Array(opCount).fill(null).map(() => []);

    //private jobs = 0;

    private currentJob?: Slot;

    private loadState: LoadState = 'none';

    private killswitches: PromiseRejecter[] = [];

    constructor() {
        this.disposables.push(this.testsEmitter);
		this.disposables.push(this.testStatesEmitter);
		this.disposables.push(this.autorunEmitter);
    }

	get tests(): vscode.Event<TestLoadStartedEvent | TestLoadFinishedEvent> {
		return this.testsEmitter.event;
	}
	get testStates(): vscode.Event<TestRunStartedEvent | TestRunFinishedEvent |
		TestSuiteEvent | TestEvent> {
		return this.testStatesEmitter.event;
	}
	get autorun(): vscode.Event<void> | undefined {
		return this.autorunEmitter.event;
    }

    get jobs() {
        const inQueue = this.jobQueues.reduce((acc, queue) => acc + queue.length, 0);
        const inProgress = this.currentJob instanceof Slot;
        return inProgress ? inQueue + 1 : inQueue;
    }

    get testsRunning() {
        const testsWaiting = this.jobQueues[OP_TYPE.RUN].length;
        const testRunning = this.currentJob && this.currentJob.type === OP_TYPE.RUN;
        return testsWaiting + (testRunning ? 1 : 0);
    }

    async load(userInitiated = true): Promise<CompletionHandleWithFailure<DerivitecTestSuiteInfo, string>> {
        if (userInitiated && this.testsRunning > 0) {
            vscode.window.showErrorMessage(`${this.testsRunning} test${plural(this.testsRunning)} ${plural(this.testsRunning, 'is')} running. Please wait or cancel the test${plural(this.testsRunning)} to refresh test suites.`);
            throw 'Tests are running; Cannot refresh test suites';
        }
        if (userInitiated) {
            this.jobQueues[OP_TYPE.LOAD].forEach(job => job.cancel());
            this.jobQueues[OP_TYPE.LOAD].length = 0;
            if (typeof this.currentJob !== 'undefined') {
                vscode.window.showInformationMessage('Test suites will be refreshed when the current operation has completed.');
            }
        }
        const release = await this.acquireSlot(OP_TYPE.LOAD);
        this.loadState = 'started';
        this.testsEmitter.fire(<TestLoadStartedEvent>{ type: this.loadState });
        const finish = (data: TestLoadFinishedEvent) => {
            this.loadState = 'finished';
            this.testsEmitter.fire(data);
            release();
        }
        return {
            pass: (suite: DerivitecTestSuiteInfo) => finish({ type: 'finished', suite }),
            fail: (errorMessage: string) => finish({ type: 'finished', errorMessage })
        };
    }

    async run(tests: string[]): Promise<CompletionHandle<void>> {
        // Fire the event immediately to keep UI responsive
        this.testStatesEmitter.fire(<TestRunStartedEvent>{ type: 'started', tests });
        const release = await this.acquireSlot(OP_TYPE.RUN);
		return () => {
            if (this.jobQueues[OP_TYPE.RUN].length === 0) {
                this.testStatesEmitter.fire(<TestRunFinishedEvent>{ type: 'finished' });
            }
            release();
        }
    }

    updateState<T extends TestSuiteEvent | TestEvent>(event: T) {
        this.testStatesEmitter.fire(event);
    }

    dispose(): void {
        this.disposables.forEach(disposable => disposable.dispose());
        this.killswitches.forEach(killswitch => killswitch('Disposing TestExplorer'));

		this.disposables = [];
    }

    private async acquireSlot(op: OP_TYPE) {
        await this.inProgress;
        let resolve!: PromiseResolver;
        let reject!: PromiseRejecter;
        this.inProgress = new Promise((res, rej) => {
            resolve = res;
            reject = rej;
        });
        this.killswitches[op] = reject;
        return resolve;
    }
}