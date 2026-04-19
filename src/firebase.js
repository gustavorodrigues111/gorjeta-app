// src/firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore, enableIndexedDbPersistence } from "firebase/firestore";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

const firebaseConfig = {
  apiKey: "AIzaSy88nij_cTJn9WFT0Wp9-xx8nO9FyvVdYx4",
  authDomain: "gorjeta-app.firebaseapp.com",
  projectId: "gorjeta-app",
  storageBucket: "gorjeta-app.firebasestorage.app",
  messagingSenderId: "143971178161",
  appId: "1:143971178161:web:0a212e136d469a07c67490"
};

const app = initializeApp(firebaseConfig);

// App Check — garante que só o domínio apptip.app acessa o Firebase
initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider("6LclvLEsAAAAAGNmvN4j87YL0j6o_GS6lP5I73SV"),
  isTokenAutoRefreshEnabled: true,
});

export const db = getFirestore(app);

// Persistência offline — dados ficam em cache local (IndexedDB)
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === "failed-precondition") {
    console.warn("Persistência offline: múltiplas abas abertas — apenas uma pode usar cache offline.");
  } else if (err.code === "unimplemented") {
    console.warn("Persistência offline: navegador não suporta IndexedDB.");
  }
});
