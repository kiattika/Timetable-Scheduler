import { initializeApp } from "firebase-admin/app";
import { getSecurityRules } from "firebase-admin/security-rules";
import fs from "fs";

initializeApp({
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || 'uttaradit-school'
});

const rules = fs.readFileSync('firestore.rules', 'utf8');

async function run() {
  try {
    const rs = getSecurityRules();
    const ruleset = await rs.createRuleset({
      source: {
        files: [{
          name: "firestore.rules",
          content: rules
        }]
      }
    });
    console.log(ruleset);
  } catch (e) {
    console.error(e.message);
  }
}
run();
