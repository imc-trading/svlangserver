'use strict';

const path = require('path');

const config = {
    target: 'node',
    entry: {
        'extension': './src/extension.ts',
        'svlangserver': './src/svlangserver.ts',
        'cached_index_loader': './src/cached_index_loader.ts',
        'svindex_builder': './src/svindex_builder.ts'
    },
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].js',
        libraryTarget: "commonjs2",
        devtoolModuleFilenameTemplate: "../[resource-path]",
    },
    devtool: 'source-map',
    externals: {
        vscode: "commonjs vscode"
    },
    resolve: {
        extensions: ['.ts', '.js']
    },
    module: {
        rules: [{
            test: /\.ts$/,
            exclude: /node_modules/,
            use: [{
                loader: 'ts-loader',
            }]
        }]
    },
}

module.exports = config;
