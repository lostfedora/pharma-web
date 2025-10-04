import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';


// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyA5a4xbvaEcoq7Saj4UHlLATFMOvHkt9u4",
  authDomain: "the-link-e1700.firebaseapp.com",
  databaseURL: "https://the-link-e1700-default-rtdb.firebaseio.com",
  projectId: "the-link-e1700",
  storageBucket: "the-link-e1700.appspot.com",
  messagingSenderId: "1045613465175",
  appId: "1:1045613465175:web:11e0e265f41e38ba535d12"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const database = getDatabase(app);
export default app;