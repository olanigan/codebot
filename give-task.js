import { createJob } from './lib/tools/create-job.js';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const task = "Create a file named VALIDATION.md in the root directory with the text 'CodeBot Validation Successful' and commit it.";
  console.log('Creating job with task:', task);
  
  try {
    const result = await createJob(task);
    console.log('Job created successfully!');
    console.log('Job ID:', result.job_id);
    console.log('Branch:', result.branch);
    console.log(`Check your repo at: https://github.com/${process.env.GH_OWNER}/${process.env.GH_REPO}/tree/${result.branch}`);
  } catch (err) {
    console.error('Failed to create job:', err.message);
  }
}

run();
