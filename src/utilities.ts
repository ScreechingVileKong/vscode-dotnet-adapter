const toString36 = (num: number) => num.toString(36).substr(2);

const getUid = () => toString36(Math.random()) + toString36(Date.now());

const createConfigItem = <T>({ default: defaultVal, ...optional }: Partial<ConfigEntry<T>>) => ({
    typecheck: (data: any) => typeof data === typeof defaultVal,
    default: defaultVal,
    ...optional
}) as ConfigEntry<T>;

const plural = (count: number) => count !== 1 ? 's' : '';

const objToListSentence = (obj: { [key: string]: number }, ignoreZeros = true) => {
    let str = '';
    Object.entries(obj).forEach(([key, value], i, arr) => {
        const needsJoiner = str.length > 0;
        const last = arr.length - 1 === i;
        const joiner = last ? ' and ' : ', ';
        if (value === 0 && ignoreZeros) return;
        if (needsJoiner) str += joiner;
        str += `${value} ${key}`;
    });
    return str;
}

export {
    getUid,
    createConfigItem,
    plural,
    objToListSentence,
}