const assert = require('assert');
const genutils = require('../lib/genutils');
const { SystemVerilogIndexer } = require('../lib/svindexer');

const indexer = new SystemVerilogIndexer();
const library = '/workspace/lib/cells.sv';
const writes = [];
let files = [library];
const writeFile = genutils.fsWriteFile;

try {
    // Exercise the library callback without a filesystem scan or linter.
    indexer._indexGlob = (includes, excludes, options, callback) => callback(null, files);
    genutils.fsWriteFile = (path, content) => {
        writes.push([path, content]);
        return Promise.resolve();
    };

    indexer.setLibraries(['lib/*.sv'], []);
    assert.deepStrictEqual(indexer.getOptionsFileContent(), ['-v ' + library]);

    files = [];
    indexer.setLibraries(['lib/*.sv'], []);
    assert.deepStrictEqual(indexer.getOptionsFileContent(), []);
    assert.deepStrictEqual(writes, [
        [indexer.getLinterOptionsFile(), '-v ' + library],
        [indexer.getLinterOptionsFile(), ''],
    ]);

    indexer.setLibraries(['lib/*.sv'], []);
    assert.strictEqual(writes.length, 2);
} finally {
    genutils.fsWriteFile = writeFile;
}
