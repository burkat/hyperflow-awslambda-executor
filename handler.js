'use strict';

var childProcess = require('child_process');
var fs = require('fs');
var async = require('async');
var aws = require('aws-sdk');
const path = require('path');
var s3 = new aws.S3();

module.exports.executor = function (event, context, mainCallback) {

    var body = JSON.parse(event.body);

    var executable = body.executable;
    var args = body.args;
    var bucket_name = body.options.bucket;
    var prefix = body.options.prefix;
    var inputs = [];
    for (let index = 0; index < body.inputs.length; ++index) {
        inputs.push(body.inputs[index].name);
    }
    var outputs = [];
    for (let index = 0; index < body.outputs.length; ++index) {
        outputs.push(body.outputs[index].name);
    }
    var files = inputs.slice();
    if (!fs.existsSync(__dirname + '/' + executable)) {
        files.push(executable);
    }

    var t_start = Date.now();
    var t_end;

    console.log('executable: ' + executable);
    console.log('arguments:  ' + args);
    console.log('inputs:      ' + inputs);
    console.log('outputs:    ' + outputs);
    console.log('bucket:     ' + bucket_name);
    console.log('prefix:     ' + prefix);

    const directory = '/tmp';
    fs.readdir(directory, (err, files) => {
        if (err) throw err;
        for (const file of files) {
            fs.unlink(path.join(directory, file), err => {
                if (err) throw err;
            });
        }
    });

    function download(callback) {
        async.each(files, function (file, callback) {

            console.log('Downloading ' + bucket_name + "/" + prefix + "/" + file);

            var params = {
                Bucket: bucket_name,
                Key: prefix + "/" + file
            };
            s3.getObject(params, function (err, data) {
                if (err) {
                    console.log("Error downloading file " + JSON.stringify(params));
                    console.log(err);
                    callback(err);
                } else {
                    fs.writeFile('/tmp/' + file, data.Body, function (err) {
                        if (err) {
                            console.log("Unable to save file " + file);
                            callback(err);
                            return;
                        }
                        if (file === executable) {
                            console.log("Downloaded executable " + JSON.stringify(params));
                        } else {
                            console.log("Downloaded file " + JSON.stringify(params));
                        }
                        callback();
                    });
                }
            });
        }, function (err) {
            if (err) {
                console.error('A file failed to process');
                callback('Error downloading')
            } else {
                console.log('All files have been downloaded successfully');
                callback()
            }
        });
    }

    function execute(callback) {
        var proc_name = __dirname + '/' + executable;


        if (fs.existsSync(/tmp/ + executable)) {
            proc_name = /tmp/ + executable;
            console.log("Running executable from S3");
            fs.chmodSync(proc_name, '777');
        }
        var proc;
        console.log('Running ' + proc_name);

        if (proc_name.endsWith(".js")) {
            proc = childProcess.fork(proc_name, args, {cwd: '/tmp'});
        } else {
            process.env.PATH = '.:' + __dirname;
            proc = childProcess.spawn(proc_name, args, {cwd: '/tmp'});

            proc.stdout.on('data', function (exedata) {
                console.log('Stdout: ' + executable + exedata);
            });

            proc.stderr.on('data', function (exedata) {
                console.log('Stderr: ' + executable + exedata);
            });
        }

        proc.on('error', function (code) {
            console.error('error!!' + executable + JSON.stringify(code));
        });
        proc.on('close', function () {
            console.log('My exe close ' + executable);
            callback()
        });
        proc.on('exit', function () {
            console.log('My exe exit ' + executable);
        });
    }

    function upload(callback) {
        async.each(outputs, function (file, callback) {

            console.log('uploading ' + bucket_name + "/" + prefix + "/" + file);

            fs.readFile('/tmp/' + file, function (err, data) {
                if (err) {
                    console.log("Error reading file " + file);
                    console.log(err);
                    callback(err);
                    return;
                }

                var params = {
                    Bucket: bucket_name,
                    Key: prefix + "/" + file,
                    Body: data
                };


                s3.putObject(params, function (err) {
                    if (err) {
                        console.log("Error uploading file " + file);
                        console.log(err);
                        callback(err);
                        return;
                    }
                    console.log("Uploaded file " + file);
                    callback();
                });
            });

        }, function (err) {
            if (err) {
                console.error('A file failed to process');
                callback('Error uploading')
            } else {
                console.log('All files have been uploaded successfully');
                callback()
            }
        });
    }

    async.waterfall([
        download,
        execute,
        upload
    ], function (err) {
        if (err) {
            console.error('Error: ' + err);
            const response = {
                statusCode: 400,
                body: JSON.stringify({
                    message: 'Bad Request: ' + JSON.stringify(err)
                })
            };

            mainCallback(null, response);
        } else {
            console.log('Success');
            t_end = Date.now();
            var duration = t_end - t_start;

            const response = {
                statusCode: 200,
                body: 'AWS Lambda exit: duration ' + duration + ' ms, executable: ' + executable + ' args: ' + args
            };

            mainCallback(null, response);
        }
    })

};