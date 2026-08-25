import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

try {
  const app = initializeApp({
    projectId: process.env.VITE_FIREBASE_PROJECT_ID
  });
  const db = getFirestore(app);
  await db.collection("apps").doc("test-admin").set({ test: true });
  console.log("Admin write success!");
} catch(e) {
  console.log("Admin write failed:", e.message);
}
