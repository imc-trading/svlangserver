import {
    ConnectionLogger,
    fsReadFile,
    fsExists
} from './genutils';

let waitForDoneAck: Boolean = false;

function handleError(error) {
    ConnectionLogger.log(error);
    waitForDoneAck = true;
    process.send([]);
}

process.on('message', (index_file) => {
    if (waitForDoneAck) {
        process.exit();
    }
    else {
        try {
            fsExists(index_file)
                .then(() => {
                    return fsReadFile(index_file);
                })
                .then((data) => {
                    waitForDoneAck = true;
                    process.send(JSON.parse(data));
                })
                .catch((error) => {
                    handleError(error);
                });
        } catch (error) {
            handleError(error);
        }
    }
});
