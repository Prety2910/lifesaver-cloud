
const firebaseConfig = {
  apiKey: "AIzaSyAUVrkqQ-_f3bm0sNZDukkgzJdkYgYSdeA",
  authDomain: "lifesaver-cloud.firebaseapp.com",
  projectId: "lifesaver-cloud",
  storageBucket: "lifesaver-cloud.firebasestorage.app",
  messagingSenderId: "525052016690",
  appId: "1:525052016690:web:e144bda9ab58ea5291242b",
  measurementId: "G-BVX758S87W"
};
// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Expose Firestore globally
const db = firebase.firestore();
