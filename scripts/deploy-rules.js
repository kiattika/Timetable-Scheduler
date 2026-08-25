import { initializeApp } from "firebase-admin/app";
import { getSecurityRules } from "firebase-admin/security-rules";
import fs from "fs";

let projectId = 'uttaradit-school';
try {
  const envFile = fs.readFileSync('.env', 'utf8');
  const match = envFile.match(/VITE_FIREBASE_PROJECT_ID=([^\s]+)/);
  if (match) {
    projectId = match[1];
  }
} catch(e) {}

initializeApp({
  projectId: projectId
});

const rules = fs.readFileSync('firestore.rules', 'utf8');

async function deployRules() {
  try {
    const rs = getSecurityRules();
    const ruleset = await rs.createRuleset({
      name: "firestore.rules",
      content: rules
    });
    console.log("Created ruleset:", ruleset.name);
    await rs.createRelease(ruleset.name, "cloud.firestore");
    console.log("Rules deployed successfully!");
  } catch(e) {
    console.error(e);
  }
}

deployRules();
