const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const app = express();
const PORT = process.env.PORT || 4000;
app.use(cors());
app.use(express.json({limit:'1mb'}));
const db = new sqlite3.Database(path.join(__dirname,'mealbridge.db'));
db.serialize(()=>{
 db.run(`CREATE TABLE IF NOT EXISTS care_donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, restaurantName TEXT NOT NULL, foodName TEXT NOT NULL,
  quantity INTEGER NOT NULL, recipientType TEXT NOT NULL, preparedAt TEXT NOT NULL, expiryAt TEXT NOT NULL,
  storage TEXT NOT NULL, allergens TEXT, location TEXT NOT NULL, notes TEXT, status TEXT NOT NULL DEFAULT 'Pending',
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
 db.run(`CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, foodName TEXT NOT NULL, quantity INTEGER NOT NULL,
  preparedAt TEXT NOT NULL, expiryAt TEXT NOT NULL, location TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
});
const required=(obj,fields)=>fields.filter(k=>obj[k]===undefined||obj[k]===null||String(obj[k]).trim()==='');
app.get('/api/health',(req,res)=>res.json({ok:true,service:'MealBridge API'}));
app.get('/api/care-donations',(req,res)=>db.all('SELECT * FROM care_donations ORDER BY id DESC',(e,rows)=>e?res.status(500).json({error:'Database read failed'}):res.json(rows)));
app.post('/api/care-donations',(req,res)=>{
 const d=req.body||{}, missing=required(d,['restaurantName','foodName','quantity','recipientType','preparedAt','expiryAt','storage','location']);
 if(missing.length)return res.status(400).json({error:'Missing required fields: '+missing.join(', ')});
 const qty=Number(d.quantity), prep=Date.parse(d.preparedAt), exp=Date.parse(d.expiryAt);
 if(!Number.isInteger(qty)||qty<1)return res.status(400).json({error:'Quantity must be a positive whole number'});
 if(!Number.isFinite(prep)||!Number.isFinite(exp)||exp<=prep)return res.status(400).json({error:'Expiry must be later than preparation time'});
 if(exp<=Date.now())return res.status(400).json({error:'Expired food cannot be donated'});
 const sql='INSERT INTO care_donations (restaurantName,foodName,quantity,recipientType,preparedAt,expiryAt,storage,allergens,location,notes) VALUES (?,?,?,?,?,?,?,?,?,?)';
 db.run(sql,[d.restaurantName,d.foodName,qty,d.recipientType,d.preparedAt,d.expiryAt,d.storage,d.allergens||'',d.location,d.notes||''],function(e){
  if(e)return res.status(500).json({error:'Could not save donation'});
  res.status(201).json({id:this.lastID,status:'Pending',message:'Donation saved. Recipient matching is not automated in this starter.'});
 });
});
app.patch('/api/care-donations/:id/status',(req,res)=>{
 const allowed=['Pending','Accepted','Assigned','Picked up','In transit','Delivered','Delivery failed','Cancelled'];
 const status=req.body&&req.body.status;
 if(!allowed.includes(status))return res.status(400).json({error:'Invalid status'});
 db.run('UPDATE care_donations SET status=? WHERE id=?',[status,req.params.id],function(e){
  if(e)return res.status(500).json({error:'Could not update status'});
  if(!this.changes)return res.status(404).json({error:'Donation not found'});
  res.json({id:Number(req.params.id),status});
 });
});
app.get('/api/listings',(req,res)=>db.all('SELECT * FROM listings ORDER BY id DESC',(e,rows)=>e?res.status(500).json({error:'Database read failed'}):res.json(rows)));
app.post('/api/listings',(req,res)=>{
 const d=req.body||{}, missing=required(d,['foodName','quantity','preparedAt','expiryAt','location']);
 if(missing.length)return res.status(400).json({error:'Missing required fields: '+missing.join(', ')});
 const qty=Number(d.quantity), prep=Date.parse(d.preparedAt), exp=Date.parse(d.expiryAt);
 if(!Number.isInteger(qty)||qty<1)return res.status(400).json({error:'Quantity must be a positive whole number'});
 if(!Number.isFinite(prep)||!Number.isFinite(exp)||exp<=prep)return res.status(400).json({error:'Expiry must be later than preparation time'});
 if(exp<=Date.now())return res.status(400).json({error:'Expired food cannot be listed'});
 db.run('INSERT INTO listings (foodName,quantity,preparedAt,expiryAt,location) VALUES (?,?,?,?,?)',[d.foodName,qty,d.preparedAt,d.expiryAt,d.location],function(e){
  if(e)return res.status(500).json({error:'Could not save listing'});
  res.status(201).json({id:this.lastID,message:'Listing saved'});
 });
});
app.listen(PORT,()=>console.log(`MealBridge API running at http://localhost:${PORT}`));
