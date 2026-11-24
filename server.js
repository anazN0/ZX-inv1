const express=require('express'),{createClient}=require('@libsql/client'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken');
const {compute}=require('./calc');
const SECRET=process.env.JWT_SECRET;
if(!SECRET||SECRET.length<24){console.error('Set JWT_SECRET (24+ characters).');process.exit(1)}
// Free hosting: set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN. Without them it uses a local file (for testing).
const db=createClient({url:process.env.TURSO_DATABASE_URL||'file:'+(process.env.DB_PATH||'data.db'),authToken:process.env.TURSO_AUTH_TOKEN});
const q=async(s,a=[])=>(await db.execute({sql:s,args:a})).rows.map(r=>({...r}));
const one=async(s,a)=>(await q(s,a))[0];
const run=async(s,a=[])=>({id:Number((await db.execute({sql:s,args:a})).lastInsertRowid)});
const SCHEMA=`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN('super_admin','staff')),active INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,phone TEXT,email TEXT,address TEXT,gstin TEXT,type TEXT DEFAULT 'Individual',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS counters(key TEXT PRIMARY KEY,next INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN('Q','I')),company TEXT NOT NULL CHECK(company IN('Z','C')),number TEXT UNIQUE NOT NULL,date TEXT NOT NULL,customer_id INTEGER NOT NULL REFERENCES customers(id),
 status TEXT NOT NULL DEFAULT 'draft',quote_status TEXT DEFAULT 'pending',payment_status TEXT DEFAULT 'unpaid',gst_mode TEXT NOT NULL DEFAULT 'none',gst_rate REAL NOT NULL DEFAULT 18,interstate INTEGER DEFAULT 0,discount REAL DEFAULT 0,
 items TEXT NOT NULL,scope TEXT,totals TEXT NOT NULL,quotation_ref INTEGER REFERENCES documents(id),created_by INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);`;
// Starting numbers for FY 26-27 (given by owner). Later years restart at 1 each April.
const SEED={ZQ:399,ZI:475,CQ:327,CI:334},FIRST_FY="26-27",CUST_START=766;
const DEFAULTS={gst_rate:18,upi_id:'',
 Z:{name:'Zolvex Home Service Private Limited',address:['Chittattumukku p.o, kadinamkulam, Trivandrum','State Name: Kerala, Code: 32 Reg no:100596'],gstin:'32AACCZ8936B1ZD',phone:'+91 8089631909',email:'info@zolvex.in',bank:['ZOLVEX HOME SERVICE PRIVATE LIMITED','Ac no: 50200119769549','IFSC: HDFC0008628','Branch: Kazhakkuttam'],seal:true,gst_allowed:true},
 C:{name:'Cyril Ventures',franchisee_of:'Zolvex Home Service Pvt Ltd',address:['K V Thomas Road, Thoppumpady','Kochi, Ernakulam ,State Name: Kerala, Code: 32'],phone:'+91 8089631909',email:'info@zolvex.in',bank:['Name: Zolvex','Ac No. :17360200004496','IFSC: FDRL0001736'],seal:false,gst_allowed:false},
 terms:['Work will be completed as per the mutually agreed schedule.','Water and electricity must be provided by the client.','Any additional work beyond the quotation will be charged separately.','Rescheduling requests must be informed at least 48 hours in advance. Late requests may be subject to availability.','We assure professional execution with high hygiene and safety standards. We look forward to your approval and the opportunity to serve your institution'],
 declaration:'Thank you for choosing Zolvex Home Service. All services were completed according to the agreed scope. If you have any questions or feedback, please feel free to contact us.'};
const setting=async k=>JSON.parse((await one('SELECT value FROM settings WHERE key=?',[k])).value);
const allSettings=async()=>Object.fromEntries((await q('SELECT key,value FROM settings')).map(r=>[r.key,JSON.parse(r.value)]));
async function init(){
 await db.executeMultiple(SCHEMA+';CREATE UNIQUE INDEX IF NOT EXISTS ux_ref ON documents(quotation_ref) WHERE quotation_ref IS NOT NULL;');
 for(const[k,v]of Object.entries(DEFAULTS))await run('INSERT OR IGNORE INTO settings VALUES(?,?)',[k,JSON.stringify(v)]);
 if(!(await one('SELECT 1 x FROM users'))&&process.env.ADMIN_EMAIL&&process.env.ADMIN_PASSWORD){
  await run('INSERT INTO users(name,email,hash,role) VALUES(?,?,?,?)',['Super Admin',process.env.ADMIN_EMAIL.toLowerCase(),bcrypt.hashSync(process.env.ADMIN_PASSWORD,12),'super_admin']);console.log('Super admin created:',process.env.ADMIN_EMAIL)}}
const fy=d=>{const t=new Date(d),y=t.getUTCMonth()>=3?t.getUTCFullYear():t.getUTCFullYear()-1;return`${String(y).slice(2)}-${String(y+1).slice(2)}`};
// One atomic statement, so two people saving at once can never get the same number.
const takeNumber=async(key,start)=>(await one('INSERT INTO counters(key,next) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET next=next+1 RETURNING next',[key,start+1])).next-1;
const docNumber=async(co,kind,date)=>{const p=co+kind,f=fy(date);return`${p}${await takeNumber(p+'|'+f,f===FIRST_FY?SEED[p]:1)}/${f}`};
const app=express();app.disable('x-powered-by');app.set('trust proxy',1);app.use(express.json({limit:'200kb'}));app.use(express.static('public'));
const err=(res,c,m)=>res.status(c).json({error:m});
const A=f=>(req,res,next)=>Promise.resolve(f(req,res,next)).catch(e=>typeof e==='string'?err(res,400,e):(console.error(e),err(res,500,'Something went wrong')));
const tries=new Map();
const cookie=(req,n)=>((req.headers.cookie||'').split(';').map(s=>s.trim().split('=')).find(a=>a[0]===n)||[])[1];
const auth=A(async(req,res,next)=>{let u;try{const{id}=jwt.verify(cookie(req,'tok'),SECRET);u=await one('SELECT id,name,email,role,active FROM users WHERE id=?',[id])}catch{}
 if(!u||!u.active)return err(res,401,'Please log in');req.user=u;next()});
const admin=(req,res,next)=>req.user.role==='super_admin'?next():err(res,403,'Super admin only');
app.post('/api/login',A(async(req,res)=>{const ip=req.ip,t=tries.get(ip)||{n:0,at:Date.now()};if(Date.now()-t.at>9e5){t.n=0;t.at=Date.now()}
 if(t.n>=10)return err(res,429,'Too many attempts. Try again in 15 minutes.');
 const u=await one('SELECT * FROM users WHERE email=?',[String(req.body.email||'').toLowerCase()]);
 if(!u||!u.active||!bcrypt.compareSync(String(req.body.password||''),u.hash)){t.n++;tries.set(ip,t);return err(res,401,'Wrong email or password')}
 tries.delete(ip);res.setHeader('Set-Cookie',`tok=${jwt.sign({id:u.id},SECRET,{expiresIn:'7d'})}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${process.env.NODE_ENV==='production'?'; Secure':''}`);
 res.json({name:u.name,role:u.role})}));
app.post('/api/logout',(req,res)=>{res.setHeader('Set-Cookie','tok=; HttpOnly; Path=/; Max-Age=0');res.json({ok:1})});
app.use('/api',auth);
app.get('/api/me',(req,res)=>res.json(req.user));
app.post('/api/password',A(async(req,res)=>{const u=await one('SELECT hash FROM users WHERE id=?',[req.user.id]),n=String(req.body.new||'');
 if(!bcrypt.compareSync(String(req.body.current||''),u.hash))return err(res,400,'Current password is wrong');if(n.length<8)return err(res,400,'New password needs 8+ characters');
 await run('UPDATE users SET hash=? WHERE id=?',[bcrypt.hashSync(n,12),req.user.id]);res.json({ok:1})}));
app.get('/api/users',admin,A(async(req,res)=>res.json(await q('SELECT id,name,email,role,active FROM users ORDER BY id'))));
app.post('/api/users',admin,A(async(req,res)=>{const{name,email,password,role='staff'}=req.body;
 if(!name||!/^\S+@\S+\.\S+$/.test(email||''))return err(res,400,'Name and valid email required');if(String(password||'').length<8)return err(res,400,'Password needs 8+ characters');if(!['staff','super_admin'].includes(role))return err(res,400,'Bad role');
 try{const r=await run('INSERT INTO users(name,email,hash,role) VALUES(?,?,?,?)',[name,email.toLowerCase(),bcrypt.hashSync(password,12),role]);res.status(201).json({id:r.id})}catch{err(res,409,'Email already exists')}}));
app.patch('/api/users/:id',admin,A(async(req,res)=>{const id=+req.params.id,{active,password}=req.body;
 if(id===req.user.id&&active===false)return err(res,400,'You cannot disable yourself');
 if(active!==undefined)await run('UPDATE users SET active=? WHERE id=?',[active?1:0,id]);
 if(password){if(String(password).length<8)return err(res,400,'Password needs 8+ characters');await run('UPDATE users SET hash=? WHERE id=?',[bcrypt.hashSync(password,12),id])}res.json({ok:1})}));
app.get('/api/settings',A(async(req,res)=>res.json(await allSettings())));
app.put('/api/settings/:key',admin,A(async(req,res)=>{if(!(req.params.key in DEFAULTS))return err(res,404,'Unknown setting');
 if(req.params.key==='gst_rate'&&!(req.body.value>=0&&req.body.value<=100))return err(res,400,'Rate must be 0-100');
 await run('UPDATE settings SET value=? WHERE key=?',[JSON.stringify(req.body.value),req.params.key]);res.json({ok:1})}));
app.get('/api/customers',A(async(req,res)=>{const s=`%${req.query.q||''}%`;res.json(await q('SELECT * FROM customers WHERE name LIKE ? OR code LIKE ? OR phone LIKE ? ORDER BY id DESC LIMIT 200',[s,s,s]))}));
app.post('/api/customers',A(async(req,res)=>{const c=req.body;if(!c.name)return err(res,400,'Customer name required');
 if(c.gstin&&!/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(c.gstin))return err(res,400,'GSTIN format looks wrong');
 const r=await run('INSERT INTO customers(code,name,phone,email,address,gstin,type) VALUES(?,?,?,?,?,?,?)',[`ZVX-C${await takeNumber('CUST',CUST_START)}`,c.name,c.phone||'',c.email||'',c.address||'',c.gstin||'',c.type||'Individual']);
 res.status(201).json(await one('SELECT * FROM customers WHERE id=?',[r.id]))}));
app.put('/api/customers/:id',A(async(req,res)=>{const c=req.body;if(!c.name)return err(res,400,'Customer name required');
 await run('UPDATE customers SET name=?,phone=?,email=?,address=?,gstin=?,type=? WHERE id=?',[c.name,c.phone||'',c.email||'',c.address||'',c.gstin||'',c.type||'Individual',req.params.id]);res.json({ok:1})}));
// Totals are ALWAYS recomputed here; the browser never decides money.
async function clean(b){const o={};
 if(!['Q','I'].includes(b.kind))throw'kind must be Q or I';if(!['Z','C'].includes(b.company))throw'company must be Z or C';
 if(!(await one('SELECT 1 x FROM customers WHERE id=?',[b.customer_id])))throw'Choose a customer';
 const items=(b.items||[]).filter(i=>String(i.desc||'').trim());if(!items.length)throw'Add at least one service';
 for(const i of items)for(const f of['qty','rate','amount'])if(i[f]!==undefined&&i[f]!==''&&!(+i[f]>=0))throw`${f} must be a number 0 or more`;
 o.mode=b.company==='C'?'none':(['none','ex','in'].includes(b.gst_mode)?b.gst_mode:'none');o.rate=await setting('gst_rate');o.interstate=!!b.interstate;o.discount=+b.discount||0;
 if(o.discount<0)throw'Discount cannot be negative';o.items=items;o.totals=compute(items,{mode:o.mode,interstate:o.interstate,discount:o.discount,rate:o.rate});
 if(o.totals.grand<=0)throw'Total must be above zero';return o}
const toDoc=r=>r&&({...r,items:JSON.parse(r.items),scope:r.scope?JSON.parse(r.scope):null,totals:JSON.parse(r.totals)});
async function insertDoc(b,user,extra={}){const o=await clean(b),date=b.date||new Date().toISOString().slice(0,10);
 const r=await run(`INSERT INTO documents(kind,company,number,date,customer_id,payment_status,gst_mode,gst_rate,interstate,discount,items,scope,totals,quotation_ref,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
 [b.kind,b.company,await docNumber(b.company,b.kind,date),date,b.customer_id,b.kind==='I'?'unpaid':null,o.mode,o.rate,o.interstate?1:0,o.discount,JSON.stringify(o.items),JSON.stringify(b.scope||null),JSON.stringify(o.totals),extra.ref||null,user.id]);
 return toDoc(await one('SELECT * FROM documents WHERE id=?',[r.id]))}
app.post('/api/documents',A(async(req,res)=>res.status(201).json(await insertDoc(req.body,req.user))));
app.get('/api/documents',A(async(req,res)=>{const w=['1=1'],a=[],s=req.query;
 if(s.kind){w.push('d.kind=?');a.push(s.kind)}if(s.company){w.push('d.company=?');a.push(s.company)}if(s.customer_id){w.push('d.customer_id=?');a.push(s.customer_id)}
 if(s.status){w.push('(d.quote_status=? OR d.payment_status=?)');a.push(s.status,s.status)}if(s.from){w.push('d.date>=?');a.push(s.from)}if(s.to){w.push('d.date<=?');a.push(s.to)}
 if(s.q){w.push('(d.number LIKE ? OR c.name LIKE ?)');a.push(`%${s.q}%`,`%${s.q}%`)}
 res.json((await q(`SELECT d.id,d.kind,d.company,d.number,d.date,d.status,d.quote_status,d.payment_status,d.totals,c.name customer,c.code customer_code FROM documents d JOIN customers c ON c.id=d.customer_id WHERE ${w.join(' AND ')} ORDER BY d.id DESC LIMIT 300`,a)).map(r=>({...r,grand:JSON.parse(r.totals).grand,totals:undefined})))}));
app.get('/api/documents/:id',A(async(req,res)=>{const d=toDoc(await one('SELECT * FROM documents WHERE id=?',[req.params.id]));d?res.json({...d,customer:await one('SELECT * FROM customers WHERE id=?',[d.customer_id])}):err(res,404,'Not found')}));
app.get('/api/documents/:id/pdf',A(async(req,res)=>{const d=toDoc(await one('SELECT * FROM documents WHERE id=?',[req.params.id]));if(!d)return err(res,404,'Not found');
 const S=await allSettings();S.Z.sf='For Zolvex Home Service';S.C.sf='for CYRIL VENTURES';
 res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`inline; filename="${d.number.replace('/','-')}.pdf"`);require('./pdf').render(d,await one('SELECT * FROM customers WHERE id=?',[d.customer_id]),S,res)}));
app.put('/api/documents/:id',A(async(req,res)=>{const d=await one('SELECT * FROM documents WHERE id=?',[req.params.id]);if(!d)return err(res,404,'Not found');
 if(d.status==='final'&&req.user.role!=='super_admin')return err(res,403,'Finalised documents are locked');
 const o=await clean({...req.body,kind:d.kind,company:d.company});
 await run(`UPDATE documents SET customer_id=?,date=?,gst_mode=?,gst_rate=?,interstate=?,discount=?,items=?,scope=?,totals=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
 [req.body.customer_id,req.body.date||d.date,o.mode,o.rate,o.interstate?1:0,o.discount,JSON.stringify(o.items),JSON.stringify(req.body.scope||null),JSON.stringify(o.totals),d.id]);res.json({ok:1,totals:o.totals})}));
app.patch('/api/documents/:id',A(async(req,res)=>{const d=await one('SELECT * FROM documents WHERE id=?',[req.params.id]);if(!d)return err(res,404,'Not found');const{status,quote_status,payment_status}=req.body;
 if(status){if(!['draft','final'].includes(status))throw'Bad status';if(d.status==='final'&&status==='draft'&&req.user.role!=='super_admin')return err(res,403,'Only super admin can reopen');await run('UPDATE documents SET status=? WHERE id=?',[status,d.id])}
 if(quote_status){if(d.kind!=='Q'||!['pending','accepted','rejected','converted'].includes(quote_status))throw'Bad quotation status';await run('UPDATE documents SET quote_status=? WHERE id=?',[quote_status,d.id])}
 if(payment_status){if(d.kind!=='I'||!['unpaid','partial','paid'].includes(payment_status))throw'Bad payment status';await run('UPDATE documents SET payment_status=? WHERE id=?',[payment_status,d.id])}res.json({ok:1})}));
app.post('/api/documents/:id/convert',A(async(req,res)=>{const qd=toDoc(await one('SELECT * FROM documents WHERE id=?',[req.params.id]));if(!qd||qd.kind!=='Q')return err(res,400,'Only a quotation can be converted');
 if(await one('SELECT 1 x FROM documents WHERE quotation_ref=?',[qd.id]))return err(res,409,'This quotation was already converted');
 let inv;try{inv=await insertDoc({kind:'I',company:qd.company,customer_id:qd.customer_id,gst_mode:qd.gst_mode,interstate:qd.interstate,discount:qd.discount,items:qd.items,scope:qd.scope},req.user,{ref:qd.id})}catch(e){if(String(e.message||'').includes('UNIQUE'))return err(res,409,'This quotation was already converted');throw e}
 await run("UPDATE documents SET quote_status='converted' WHERE id=?",[qd.id]);res.status(201).json(inv)}));
app.get('/api/dashboard',A(async(req,res)=>{const c=async w=>(await one(`SELECT COUNT(*) n FROM documents WHERE ${w}`)).n;
 res.json({quotations:await c("kind='Q'"),invoices:await c("kind='I'"),pending_quotations:await c("kind='Q' AND quote_status='pending'"),accepted_quotations:await c("kind='Q' AND quote_status IN('accepted','converted')"),paid_invoices:await c("kind='I' AND payment_status='paid'"),unpaid_invoices:await c("kind='I' AND payment_status!='paid'")})}));
init().then(()=>app.listen(process.env.PORT||3000,()=>console.log('Running on port',process.env.PORT||3000))).catch(e=>{console.error(e);process.exit(1)});
