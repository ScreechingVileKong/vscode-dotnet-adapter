import * as vscode from 'vscode';
import { TestLoadStartedEvent, TestLoadFinishedEvent, TestRunStartedEvent, TestRunFinishedEvent } from 'vscode-test-adapter-api';

type PromiseResolver = (value?: void | PromiseLike<void> | undefined) => void;

type PromiseRejecter = (reason?: any) => void;

type CompletionHandle<T> = (data: T) => void;

type CompletionHandleWithFailure<T, P> = { pass: CompletionHandle<T>, fail: CompletionHandle<P> };

enum OP_TYPE { LOAD, RUN };

export default class TestExplorer {
    private disposables: { dispose(): void }[] = [];

    private readonly testsEmitter =
        new vscode.EventEmitter<TestLoadStartedEvent | TestLoadFinishedEvent>();

	private readonly testStatesEmitter = new vscode.EventEmitter<TestRunStartedEvent |
        TestRunFinishedEvent | TestSuiteEvent | TestEvent>();

    private readonly autorunEmitter = new vscode.EventEmitter<void>();

    private inProgress: Promise<void> = Promise.resolve();

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

    async load(): Promise<CompletionHandleWithFailure<DerivitecTestSuiteInfo, string>> {
        const release = await this.acquireSlot(OP_TYPE.LOAD);
        this.testsEmitter.fire(<TestLoadStartedEvent>{ type: 'started' });
        const finish = (data: TestLoadFinishedEvent) => {
            this.testsEmitter.fire(data);
            release();
        }
        return {
            pass: (suite: DerivitecTestSuiteInfo) => finish({ type: 'finished', suite }),
            fail: (errorMessage: string) => finish({ type: 'finished', errorMessage })
        };
    }

    async run(tests: string[]): Promise<CompletionHandle<void>> {
        const release = await this.acquireSlot(OP_TYPE.RUN);
        this.testStatesEmitter.fire(<TestRunStartedEvent>{ type: 'started', tests });
		return () => {
            this.testStatesEmitter.fire(<TestRunFinishedEvent>{ type: 'finished' });
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