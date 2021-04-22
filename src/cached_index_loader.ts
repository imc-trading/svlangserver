import {
    fsReadFile,
    fsExists
} from './genutils';

let done: Boolean = false;
process.on('message', (index_file) => {
    if (done) {
        process.exit();
    }
    else {
        fsExists(index_file).then(() => {
            return fsReadFile(index_file);
        })
        .then((data) => {
            done = true;
            process.send(JSON.parse(data));
        })
        .catch((err) => {
            done = true;
            process.send([]);
        });
    }
});
