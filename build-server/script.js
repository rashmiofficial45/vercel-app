const { exec } = require("child_process");
const path = require("path");
const fs = require('fs');
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
var mime = require('mime-types');
const dotenv = require('dotenv');
const Valkey = require("ioredis");

dotenv.config();

const valkey = new Valkey("REMOVED_SECRET")

const s3Client = new S3Client({
  region: "eu-north-1",
});

const PROJECT_ID = process.env.PROJECT_ID;

async function init() {
  console.log("Executing script");

  // FIX 1: Correctly resolve the output path
  const outPath = path.join(__dirname, "output");

  const p = exec(`cd ${outPath} && npm install && npm run build -- --base=/__outputs/${PROJECT_ID}/`)

  p.stdout.on("data", (data) => {
    console.log(data.toString());
  });

  // FIX 2: Listen to the "data" event for stderr to catch build/shell errors
  p.stderr.on("data", (data) => {
    console.error("stderr: ", data.toString());
  });

  p.on("close", async (code) => {
    // FIX 3: Stop execution if the build command fails
    if (code !== 0) {
      console.error(`Build process exited with code ${code}. Aborting S3 upload.`);
      return;
    }

    console.log("Build completed successfully");

    const distFolderPath = path.join(__dirname, "output", "dist");

    // Check if dist folder actually exists before reading
    if (!fs.existsSync(distFolderPath)) {
      console.error("Error: dist folder not found. Did Vite output to a different directory?");
      return;
    }

    const allFiles = fs.readdirSync(distFolderPath, { recursive: true });

    for (const file of allFiles) {
      const filePath = path.join(distFolderPath, file);

      if (fs.lstatSync(filePath).isDirectory()) {
        continue;
      } else {
        // FIX 4: Use relative path for clean S3 keys (e.g., 'assets/index.js' instead of '/home/app/.../index.js')
        const fileKey = path.relative(distFolderPath, filePath);

        const command = new PutObjectCommand({
          Bucket: "vercel-app-output",
          Key: `__outputs/${PROJECT_ID}/${fileKey}`,
          Body: fs.createReadStream(filePath),
          ContentType: mime.lookup(filePath) || 'application/octet-stream'
        });

        await s3Client.send(command);
        console.log(`Uploaded ${fileKey} to S3`);
      }
    }
  });
}

init();