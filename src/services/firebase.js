// Firebase (App, Auth e Firestore)
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyC6StDHxZn5VakxH1MDqiYDKAGx6f1QLJg",
  authDomain: "agt-controller3.firebaseapp.com",
  projectId: "agt-controller3",
  storageBucket: "agt-controller3.firebasestorage.app",
  messagingSenderId: "1015891452736",
  appId: "1:1015891452736:web:42c93a93415ecda4cf90a5",
  measurementId: "G-5NSDLRRKZ9",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
