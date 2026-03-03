const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getCountFromServer } = require('firebase/firestore');

const configs = [
  {name:'new', apiKey:'AIzaSyC9yAYVeTCcHlLx7RRHdyTLzu-jaMGl_vo', authDomain:'gestor-de-expedientes-pro.firebaseapp.com', projectId:'gestor-de-expedientes-pro', storageBucket:'gestor-de-expedientes-pro.firebasestorage.app', messagingSenderId:'266201334385', appId:'1:266201334385:web:demo'},
  {name:'old', apiKey:'AIzaSyCPtIvlPqSFj3FAsoShh5xgc2R_izUpCp8', authDomain:'gestor-expedientes-pro.firebaseapp.com', projectId:'gestor-expedientes-pro', storageBucket:'gestor-de-expedientes-pro.firebasestorage.app', messagingSenderId:'106962932821', appId:'1:106962932821:web:f3a3deaef34cde4add30dc'}
];

(async()=>{
  for (const cfg of configs){
    const app = initializeApp(cfg, cfg.name);
    const db = getFirestore(app);
    const cols = ['clients','cases','invoices','economicBalances','economicLedgerEntries','clientEconomicSummary'];
    const out = {};
    for (const c of cols){
      try{
        const snap = await getCountFromServer(collection(db,c));
        out[c] = snap.data().count;
      }catch(e){
        out[c] = `ERR:${e.code||e.message}`;
      }
    }
    console.log(cfg.projectId, out);
  }
})();
