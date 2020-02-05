import * as vscode from 'vscode';
import { plural, objToListSentence } from './utilities';

const loadedDefault = () => ({
    loaded: 0,
    added: 0,
    addedFromCache: 0,
    updatedFromFile: 0,
    addedFromFile: 0,
});

export type Loaded = ReturnType<typeof loadedDefault>;

export default class OutputManager {
    private internalLoaded: Loaded = loadedDefault();

    private canAppend = true;

    private log: string[] = [];

    constructor(
        private readonly outputchannel: vscode.OutputChannel,
    ) {
        this.refresh();
    }

    get loaded() {
        const obj = {};
        const keys = Object.keys(this.internalLoaded) as (keyof Loaded)[];
        keys.forEach(key => Object.defineProperty(obj, key, {
            get: () => this.internalLoaded[key],
            set: (value: number) => {
                this.canAppend = false;
                this.internalLoaded[key] = value;
            }
        }));
        return obj as Loaded;
    }

    update(status?: string, summarise: boolean = false) {
        let logItem;
        if (status) {
            logItem = `[${new Date().toISOString()}] ${status}`;
            if (summarise) logItem += ` ${this.summarise()}`;
            this.log.push(logItem);
            if (this.canAppend) return this.outputchannel.appendLine(logItem);
        }
        if (!this.canAppend) this.refresh();
        this.canAppend = true;
    }

    refresh() {
        const { loaded, added, addedFromCache, addedFromFile, updatedFromFile } = this.internalLoaded;
        this.outputchannel.clear();
        this.outputchannel.appendLine(`
Loaded ${loaded} test file${plural(loaded)}
Added ${added} test${plural(added)} to the test suite
    ${addedFromFile} new test file${plural(addedFromFile)}
    ${addedFromCache} cached test file${plural(addedFromCache)}
    ${updatedFromFile} test file${plural(updatedFromFile)} updated since last cache

${this.log.join('\n')}`);
    }

    summarise() {
        const { loaded, added, addedFromCache, addedFromFile, updatedFromFile } = this.internalLoaded;
        const breakdown = { 'new': addedFromFile, 'cached': addedFromCache, 'updated': updatedFromFile };
        return `${added} tests from ${loaded} files; ${objToListSentence(breakdown)}`;
    }

    loader() {
        const uid = setInterval(() => {
            this.canAppend = false;
            this.outputchannel.append('.')
        }, 1000);
        return () => {
            clearInterval(uid);
            this.canAppend = false;
            this.outputchannel.append('Complete.');
        }
    }

    resetLoaded() {
        // Reset output numbers
		Object.keys(this.internalLoaded).forEach((key) => Object.assign(this.internalLoaded, { [key]: 0 }));
    }
}