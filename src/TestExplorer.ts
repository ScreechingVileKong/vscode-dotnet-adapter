import * as vscode from 'vscode';
import { TestLoadStartedEvent, TestLoadFinishedEvent, TestRunStartedEvent, TestRunFinishedEvent } from 'vscode-test-adapter-api';

type CompletionHandle<T> = (data: T) => void;

type CompletionHandleWithFailure<T, P> = { pass: CompletionHandle<T>, fail: CompletionHandle<P> };

export default class TestExplorer {
    private disposables: { dispose(): void }[] = [];

    private readonly testsEmitter =
        new vscode.EventEmitter<TestLoadStartedEvent | TestLoadFinishedEvent>();

	private readonly testStatesEmitter = new vscode.EventEmitter<TestRunStartedEvent |
        TestRunFinishedEvent | TestSuiteEvent | TestEvent>();

    private readonly autorunEmitter = new vscode.EventEmitter<void>();

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

    load(): CompletionHandleWithFailure<DerivitecTestSuiteInfo, string> {
        this.testsEmitter.fire(<TestLoadStartedEvent>{ type: 'started' });
        const finish = (data: TestLoadFinishedEvent) => this.testsEmitter.fire(data);
        return {
            pass: (suite: DerivitecTestSuiteInfo) => finish({ type: 'finished', suite }),
            fail: (errorMessage: string) => finish({ type: 'finished', errorMessage })
        };
    }

    run(tests: string[]): CompletionHandle<void> {
        this.testStatesEmitter.fire(<TestRunStartedEvent>{ type: 'started', tests });
		return () => this.testStatesEmitter.fire(<TestRunFinishedEvent>{ type: 'finished' });
    }

    updateState<T extends TestSuiteEvent | TestEvent>(event: T) {
        this.testStatesEmitter.fire(event);
    }

    dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.disposables = [];
	}
}