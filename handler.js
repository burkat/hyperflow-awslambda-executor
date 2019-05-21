"use strict";

const childProcess = require("child_process");
const fs = require("fs");
const async = require("async");
const aws = require("aws-sdk");
const path = require("path");
const s3 = new aws.S3();
const directory = "/tmp";

module.exports.executor = function (event, context, mainCallback) {

    const body = JSON.parse(event.body);

    const metrics = {
        "lambdaStart": Date.now(),
        "lambdaEnd": "",
        "downloadStart": "",
        "downloadEnd": "",
        "executionStart": "",
        "executionEnd": "",
        "uploadStart": "",
        "uploadEnd": "",
    };

    const executable = body.executable;
    const args = body.args;
    const bucket_name = body.options.bucket;
    const prefix = body.options.prefix;
    const inputs = [];
    const logName = body.logName;
    for (let index = 0; index < body.inputs.length; ++index) {
        inputs.push(body.inputs[index].name);
    }
    const outputs = [];
    for (let index = 0; index < body.outputs.length; ++index) {
        outputs.push(body.outputs[index].name);
    }
    const files = inputs.slice();
    if (!fs.existsSync(__dirname + "/" + executable)) {
        files.push(executable);
    }

    console.log("Executable: " + executable);
    console.log("Arguments:  " + args);
    console.log("Inputs:     " + inputs);
    console.log("Outputs:    " + outputs);
    console.log("Bucket:     " + bucket_name);
    console.log("Prefix:     " + prefix);

    async.waterfall([
        clearTmpDir,
        download,
        execute,
        upload
    ], async function (err) {
        if (err) {
            console.error("Error: " + err);
            const response = {
                statusCode: 400,
                body: JSON.stringify({
                    message: "Bad Request: " + JSON.stringify(err)
                })
            };

            mainCallback(null, response);
        } else {
            console.log("Success");
            metrics.lambdaEnd = Date.now();
            const metricsString = "fargate start: " + metrics.lambdaStart + " fargate end: " + metrics.lambdaEnd +
                " download start: " + metrics.downloadStart + " download end: " + metrics.downloadEnd +
                " execution start: " + metrics.executionStart + " execution end: " + metrics.executionEnd +
                " upload start: " + metrics.uploadStart + " upload end: " + metrics.uploadEnd;
            if (logName !== undefined) {
                await s3.putObject({
                    Bucket: bucket_name,
                    Key: "logs/" + logName,
                    ContentType: 'text/plain',
                    Body: metricsString
                }).promise();
            }
            const response = {
                statusCode: 200,
                body: metricsString
            };
            mainCallback(null, response);
        }
    });

    function clearTmpDir(callback) {
        fs.readdir(directory, (err, files) => {
            if (err) throw err;
            for (const file of files) {
                fs.unlink(path.join(directory, file), err => {
                    if (err) throw err;
                });
            }
        });
        callback();
    }

    function download(callback) {
        metrics.downloadStart = Date.now();
        async.each(files, function (file, callback) {

            console.log("Downloading " + bucket_name + "/" + prefix + "/" + file);

            const params = {
                Bucket: bucket_name,
                Key: prefix + "/" + file
            };
            s3.getObject(params, function (err, data) {
                if (err) {
                    console.log("Error downloading file " + JSON.stringify(params));
                    console.log(err);
                    callback(err);
                } else {
                    fs.writeFile("/tmp/" + file, data.Body, function (err) {
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
            metrics.downloadEnd = Date.now();
            if (err) {
                console.error("Failed to download file " + file);
                // 500 status code will force the Hyperflow to retry request in case of race condition on S3
                const response = {
                    statusCode: 500,
                    body: JSON.stringify({
                        message: "S3 download error"
                    })
                };
                mainCallback(null, response);
            } else {
                console.log("All files have been downloaded successfully");
                callback()
            }
        });
    }

    function execute(callback) {
        metrics.executionStart = Date.now();
        let proc_name = __dirname + "/" + executable;


        if (fs.existsSync(/tmp/ + executable)) {
            proc_name = /tmp/ + executable;
            console.log("Running executable from S3");
            fs.chmodSync(proc_name, "777");
        }
        let proc;
        console.log("Running " + proc_name);

        if (proc_name.endsWith(".js")) {
            proc = childProcess.fork(proc_name, args, {cwd: "/tmp"});
        } else {
            process.env.PATH = ".:" + __dirname;
            proc = childProcess.spawn(proc_name, args, {cwd: "/tmp"});

            proc.stdout.on("data", function (exedata) {
                console.log("Stdout: " + executable + exedata);
            });

            proc.stderr.on("data", function (exedata) {
                console.log("Stderr: " + executable + exedata);
            });
        }

        proc.on("error", function (code) {
            console.error("Error!!" + executable + JSON.stringify(code));
        });
        proc.on("exit", function () {
            console.log("My exe exit " + executable);
        });

        proc.on("close", function () {
            console.log("My exe close " + executable);
            callback();
            metrics.executionEnd = Date.now();
        });
    }

    function upload(callback) {
        metrics.uploadStart = Date.now();
        async.each(outputs, function (file, callback) {

            console.log("Uploading " + bucket_name + "/" + prefix + "/" + file);

            fs.readFile("/tmp/" + file, function (err, data) {
                if (err) {
                    console.log("Error reading file " + file);
                    console.log(err);
                    callback(err);
                    return;
                }

                const params = {
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
            metrics.uploadEnd = Date.now();
            if (err) {
                console.error("A file failed to process");
                callback("Error uploading")
            } else {
                console.log("All files have been uploaded successfully");
                callback()
            }
        });
    }

};