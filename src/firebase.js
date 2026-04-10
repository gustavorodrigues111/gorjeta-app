// src/firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSy88nij_cTJn9WFT0Wp9-xx8nO9FyvVdYx4",
  authDomain: "gorjeta-app.firebaseapp.com",
  projectId: "gorjeta-app",
  storageBucket: "gorjeta-app.firebasestorage.app",
  messagingSenderId: "143971178161",
  appId: "1:143971178161:web:0a212e136d469a07c67490"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
