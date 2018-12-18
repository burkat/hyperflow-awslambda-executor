# Hyperflow AWS Lambda Executor

This is an Executor for HyperFlow https://github.com/dice-cyfronet/hyperflow  workflow engine which uses AWS Lambda: https://aws.amazon.com/lambda/

## Installation

### Prerequsites

To run HyperFlow, you need Node.js: https://nodejs.org and Redis database running in the background: http://redis.io/

### Installing HyperFlow

Should be simple as that: `npm install https://github.com/hyperflow-wms/hyperflow/archive/develop.zip`

### Installing and deploying the Executor

Sources are available here: https://github.com/mpawlik/hyperflow-awslambda-executor, we need to clone the `master` branch. 

Executor is provided as a Serverless framework (sls) project. Quick guide on using sls@aws can be found here: https://serverless.com/framework/docs/providers/aws/guide/quick-start/
In summary you need to:
* install the framework's npm
* create an input/output s3 bucket
* review `serverless.yml` file, change the `Resource arn` to match the created bucket, sls creates dedicated role for the function with access rights to the bucket
* setup AWS credentials for current user with sufficient privileges to create users, buckets, manage access rights etc. in ~/.aws/ dir (just like when using AWS CLI, the CLI itself is not required)
* do `$ sls deploy` 

Make not of the URL reported by sls, it will be used later on.

### (Optional) Bundling binaries with the Executor

If any binaries are to be bundled with the executor they need some additional preparation. You should not make any assumptions regarding the execution environment the functions are deployed into, except that it is Linux.

One way to make sure that your executables will run in the cloud is to link them statically. For example, to compile Montage binaries you need to add the following flags to the `LIBS` variable in the Makefiles:
```
-static -static-libgcc
``` 

Once the static version of binaries is ready, you should copy them to your local `hyperflow-aws-executor ` directory containing the main `handler.js` of the Executor.

### (Optional) Running .js scripts and getting executables from S3

It is possible to run .js script. When .js file is detected as executable, fork process is created. 

When expected executables are not given during deployment process, the handler will look for them in S3. 
The files will be downloaded to /tmp, given exec permissions and executed.

## Preparing the workflow and input data

### Creating the workflow

For running Montage workflow, you should follow the tutorial at https://github.com/hyperflow-wms/hyperflow/wiki/TutorialAMQP. You do not need to install AMQP Executor or RabbitMQ, since the AWS Lambda is a fully serverless solution. When converting the workflow from DAX to JSON format, you should use `RESTServiceCommand` option:

```
hflow-convert-dax 0.25/workdir/dag.xml RESTServiceCommand > 0.25/workdir/dag.json
```

### Uploading input data

If your workflow uses input or output files, the executor can do a stage in/out operation from the S3 bucket created while deploying Executor. You need to copy all the input files into this bucket, this can be done with help of `aws s3` CLI, for example for Montage workflow for 0.25 degree:

```
aws s3 cp --recursive data/0.25/input/ s3://hyperflow.montage.test/0.25
```

### Configure HyperFlow


The last step is to supply required information to HyperFlow, so it knows where to send requests, and which storage to use.
This can be done by editing file: `hyperflow/functions/RESTServiceCommand.config.js`, or by supplying the proper environment variables (preferred way). Required vars are:

* `SERVICE_URL` - URL of deployed Executor, generated during Executor deployment
* `STORAGE` - should be set to `s3`
* `BUCKET` - name of the bucket (eg. `hyperflow.montage.test`)
* `PATH` - path of input/output dir in the bucket (eg. `0.25`)


## Running the workflow

```
./bin/hflow run /path/to/your/montage/0.25/workdir/dag.json -s
```

