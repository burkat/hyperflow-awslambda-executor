'use strict';

var spawn = require('child_process').spawn;
var fs = require('fs');
var async = require('async');
var aws = require('aws-sdk');
var s3 = new aws.S3();

exports.handler = function (event, context, mainCallback) {

    // console.log(event);

    var body = JSON.parse(event.body);

    var executable = body.executable;
    var args = body.args;
    var inputs = body.inputs;
    var outputs = body.outputs;
    var bucket_name = body.options.bucket;
    var prefix = body.options.prefix;

    var t_start = Date.now();
    var t_end;

    console.log('executable: ' + executable);
    console.log('args:       ' + args);
    console.log('inputs:     ' + inputs);
    console.log('inputs[0].name:     ' + inputs[0].name);
    console.log('outputs:    ' + outputs);
    console.log('bucket:     ' + bucket_name);
    console.log('prefix:     ' + prefix);


    function download(callback) {
        async.each(inputs, function (file, callback) {

            var file_name = file.name;
            console.log('downloading ' + bucket_name + "/" + prefix + "/" + file_name);

            var params = {
                Bucket: bucket_name,
                Key: prefix + "/" + file_name
            };

            s3.getObject(params, function (err, data) {
                if (err) {
                    console.log("Error downloading file " + JSON.stringify(params));
                    console.log(err);
                    callback(err);
                } else {
                    fs.writeFile('/tmp/' + file_name, data.Body, function (err) {
                        if (err) {
                            console.log("Unable to save file " + file_name);
                            callback(err);
                            return;
                        }
                        console.log("Downloaded file " + JSON.stringify(params));
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

        console.log('spawning ' + proc_name);
        process.env.PATH = '.:' + __dirname; // add . and __dirname to PATH since e.g. in Montage mDiffFit calls external executables
        var proc = spawn(proc_name, args, {cwd: '/tmp'});

        proc.on('error', function (code) {
            console.error('error!!' + executable + JSON.stringify(code));
        });

        proc.stdout.on('data', function (exedata) {
            console.log('Stdout: ' + executable + exedata);
        });

        proc.stderr.on('data', function (exedata) {
            console.log('Stderr: ' + executable + exedata);
        });

        proc.on('close', function (code) {
            console.log('My exe close' + executable);
            callback()
        });

        proc.on('exit', function (code) {
            console.log('My exe exit' + executable);
        });

    }

    function upload(callback) {
        async.each(outputs, function (file, callback) {

            var file_name = file.name;
            console.log('uploading ' + bucket_name + "/" + prefix + "/" + file_name);

            fs.readFile('/tmp/' + file_name, function(err, data) {
                if (err) {
                    console.log("Error reading file " + file_name);
                    console.log(err);
                    callback(err);
                    return;
                }

                var params = {
                    Bucket: bucket_name,
                    Key: prefix + "/" + file_name,
                    Body: data
                };


                s3.putObject(params, function(err, data) {
                   if (err){
                       console.log("Error uploading file " + file_name);
                       console.log(err);
                       callback(err);
                       return;
                   }
                   console.log("Uploaded file " + file_name);
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
    ], function (err, result) {
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
                body: JSON.stringify({
                    message: 'AWS Lambda exit: start ' + t_start + ' end ' + t_end + ' duration ' + duration + ' ms, executable: ' + executable + ' args: ' + args
                })
            };

            mainCallback(null, response);
        }
    })

};
