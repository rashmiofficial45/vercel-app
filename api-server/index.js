const express = require("express")
const { ECSClient, RunTaskCommand } = require("@aws-sdk/client-ecs")
const dotenv = require("dotenv")
const { generateSlug } = require("random-word-slugs")
dotenv.config()
const app = express()

app.use(express.json())

const ecsClient = new ECSClient({
  region: "eu-north-1",
  // credentials: {
  //   accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  //   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  // }
})

const config = {
  CLUSTER_NAME: process.env.CLUSTER_NAME,
  TASK_DEFINITION: process.env.TASK_DEFINITION,
}


app.post("/project", async(req, res) => {
  const { gitUrl } = req.body
  console.log(gitUrl)
  const projectSlug = generateSlug()

  const command = new RunTaskCommand({
    cluster: config.CLUSTER_NAME,
    taskDefinition: config.TASK_DEFINITION,
    launchType: "FARGATE",
    platformVersion: "LATEST",
    count: 1,
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: ["subnet-0c2371b1c01b5a202", "subnet-0a586ce1c1ed13762", "subnet-0af9bd61825b91616"],
        securityGroups: ["sg-078a4a6044dfa8067"],
        assignPublicIp: "ENABLED",
      },
    },
    overrides: {
      containerOverrides: [
        {
          name: "build-image",
          environment: [
            {
              name: "GIT_REPOSITORY__URL",
              value: gitUrl,
            },
            {
              name: "PROJECT_ID",
              value: projectSlug,
            },
          ],
        },
      ],
      taskRoleArn: "arn:aws:iam::819720040633:role/ecs-build-worker-s3-upload",
    },
  })
  await ecsClient.send(command)
  res.json({ status: "queued", projectSlug, deployUrl: `http://${projectSlug}.localhost:8000` })
})

app.listen(3000, () => {
  console.log("Server started on port 3000")
})