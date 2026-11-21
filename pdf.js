const PDFDocument=require('pdfkit'),path=require('path');
const A=n=>path.join(__dirname,'assets',n);
const inr=p=>'₹'+(p/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const dmy=d=>d.split('-').reverse().join('-').replace(/-20(\d\d)$/,'-$1');
exports.render=(d,c,S,res)=>{
 const co=S[d.company],q=d.kind==='Q',t=d.totals,doc=new PDFDocument({size:'A4',margin:50,info:{Title:d.number}});
 doc.pipe(res);doc.registerFont('R',A('DejaVuSans.ttf'));doc.registerFont('B',A('DejaVuSans-Bold.ttf'));
 const head=()=>{doc.save().opacity(.2).image(A('logo.jpg'),150,270,{width:300}).restore();doc.fillColor('#000').font('R').fontSize(10).text(`${q?'Quotation':'Invoice'} no: ${d.number}`,50,45,{lineBreak:false}).text(`Date: ${dmy(d.date)}`,50,58,{lineBreak:false});doc.x=50;doc.y=80};
 head();doc.on('pageAdded',head);
 doc.font('B').fontSize(21).text(q?'QUOTATION':'TAX INVOICE',300,105,{width:245,align:'right',lineBreak:false});
 doc.x=50;doc.y=90;doc.font('B').fontSize(16).text(co.name,50,90,{width:340});
 if(co.franchisee_of)doc.font('R').fontSize(10).text('Authorised Franchisee of ',{continued:true,width:330}).font('B').fontSize(14).text(co.franchisee_of);
 doc.font('R').fontSize(11);[...co.address,...(co.gstin?['GST: '+co.gstin]:[]),co.phone,co.email].forEach(l=>doc.text(l,50,undefined,{width:330}));
 doc.moveDown(1.2).font('R').fontSize(12).text('To',50).font('B').text(c.name).font('R').text('ID: '+c.code);
 [c.phone,c.address,c.gstin&&'GSTIN: '+c.gstin].filter(Boolean).forEach(l=>doc.text(l,{width:400}));
 doc.text('Place of Supply: '+(d.interstate?'Other state':'Kerala'));
 const sc=d.scope;if(sc&&(sc.points?.length||sc.exclusions)){doc.moveDown(.8);
  if(sc.points?.length){doc.font('B').fontSize(11).text('Scope of Work'+(sc.title?' – '+sc.title:''),50);doc.font('R').fontSize(10.5);sc.points.forEach(p=>doc.text('•  '+p,66,undefined,{width:480}))}
  if(sc.exclusions){doc.font('B').fontSize(10.5).text('Exclusions: ',50,undefined,{continued:true,width:495}).font('R').text(sc.exclusions)}}
 const X=[50,90,320,375,455],W=[40,230,55,80,90];
 const cell=(i,txt,y,h,al='left',bold)=>doc.font(bold?'B':'R').fontSize(bold?9.5:11).fillColor('#000').text(txt,X[i]+5,y+(bold?7:4),{width:W[i]-10,align:al,lineBreak:i===1});
 const row=(vals,h,fill,bold)=>{const y=doc.y;if(y+h>760){doc.addPage();return row(vals,h,fill,bold)}
  vals.forEach((v,i)=>{(fill&&fill!=='#fff'?doc.rect(X[i],y,W[i],h).fillAndStroke(fill,'#bbb'):doc.rect(X[i],y,W[i],h).stroke('#bbb'));cell(i,v,y,h,bold?'center':['center','left','center','center','right'][i],bold)});doc.y=y+h;doc.x=50};
 const th=()=>row(['Sl no','DESCRIPTION','UNIT','UNIT PRICE','TOTAL Amount'],24,'#fff',true);
 doc.moveDown(1);if(doc.y>700)doc.addPage();th();
 d.items.forEach((it,i)=>{const h=Math.max(22,doc.font('R').fontSize(11).heightOfString(it.desc,{width:220})+8);if(doc.y+h>760){doc.addPage();th()}
  row([String(i+1),it.desc,it.qty||'',it.rate||'',t.lines[i]?inr(t.lines[i]):''],h,i%2?'#fff':'#f1f1f1')});
 const tot=(l,v,h=22,b)=>{const y=doc.y;if(y+h>760)doc.addPage();const y2=doc.y;doc.font('B').fontSize(11).fillColor('#000').text(l,50,y2+5,{width:395,align:'right',lineBreak:false});
  doc.rect(X[4],y2,W[4],h).stroke('#bbb');doc.font('B').fontSize(b?12:11).text(v,X[4]+5,y2+(h>30?12:5),{width:W[4]-10,align:'right',lineBreak:false});doc.y=y2+h;doc.x=50};
 tot('SUBTOTAL',inr(t.subtotal));if(t.discount)tot('DISCOUNT','− '+inr(t.discount));
 if(d.gst_mode!=='none'){const r=d.gst_rate;tot(d.gst_mode==='in'?'TAXABLE VALUE (excl. GST)':'TAXABLE VALUE',inr(t.taxable));
  if(d.interstate)tot(`IGST @ ${r}%`,inr(t.igst));else{tot(`CGST @ ${r/2}%`,inr(t.cgst));tot(`SGST @ ${r/2}%`,inr(t.sgst))}}
 tot('GRAND TOTAL',inr(t.grand),38,1);
 if(doc.y>640)doc.addPage();
 doc.moveDown(.5).font('R').fontSize(10).text('E.&O.E',50);doc.fontSize(11).text('Amount Chargeable (in words)').font('B').text(t.words,{width:300});
 const y0=doc.y+14;doc.font('B').fontSize(11).text(co.sf||'',350,y0,{width:195,align:'center'});
 if(co.seal)doc.image(A('seal.png'),400,y0+18,{width:95});doc.font('R').fontSize(10).text('Authorised signatory',350,y0+(co.seal?118:60),{width:195,align:'center'});
 doc.font('R').fontSize(11);let ly=y0;co.bank.forEach(l=>{doc.text(l,50,ly,{width:290});ly=doc.y});
 if(!q){ly+=6;doc.font('B').text('Payment status: '+({unpaid:'Unpaid',partial:'Partially paid',paid:'Paid'})[d.payment_status],50,ly,{width:290});if(S.upi_id)doc.font('R').text('UPI: '+S.upi_id,50,doc.y,{width:290});ly=doc.y}
 doc.x=50;doc.y=Math.max(ly,y0+(co.seal?135:75))+14;if(doc.y>690)doc.addPage();
 doc.font('B').fontSize(11).text('Terms and Conditions',50);doc.font('R').fontSize(10);S.terms.forEach(x=>doc.text('•  '+x,50,undefined,{width:495}));
 if(!q){if(doc.y>650)doc.addPage();else doc.moveDown(1);const by=doc.y;doc.rect(50,by,260,96).stroke('#999');doc.font('B').fontSize(11).text('Declaration',60,by+8).font('R').fontSize(10).text(S.declaration,60,undefined,{width:240})}
 doc.end()};
