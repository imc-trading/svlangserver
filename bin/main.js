#!/usr/bin/env node

const package = require('../package')

const args = process.argv

const version = args.find(s => s == '-v' || s == '--version')
const help = args.find(s => s == '-h' || s == '--help')

if (version) {
    console.log(`Version is ${package.version}`)
}
else if (help) {
    console.log(`
Usage:
    ${process.argv0} [lsp server options]
    ${process.argv0} -h | --help
    ${process.argv0} -v | --version

Note:
    The server defaults to stdio connection
    `)
}
else {
    const comm_mode = args.find(s => s == '--stdio' || s == '--node-ipc' || s.startsWith('--socket='));
    if (!comm_mode) {
        process.argv.push('--stdio');
    }
    const server = require('../lib/svlangserver')
}
