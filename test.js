const a=require('assert'),{compute,words}=require('./calc');
let r=compute([{amount:10000},{amount:1000}],{mode:'none'});a.equal(r.grand,1100000);
r=compute([{amount:10000}],{mode:'ex'});a.equal(r.grand,1180000);a.equal(r.cgst,90000);a.equal(r.sgst,90000);
r=compute([{amount:11800}],{mode:'in'});a.equal(r.taxable,1000000);a.equal(r.tax,180000);a.equal(r.grand,1180000);
r=compute([{amount:10000}],{mode:'ex',interstate:true});a.equal(r.igst,180000);a.equal(r.cgst,0);
r=compute([{qty:5,rate:300},{amount:800}],{discount:100});a.equal(r.subtotal,230000);a.equal(r.grand,220000);
r=compute([{amount:1000.01}],{mode:'in'});a.equal(r.cgst+r.sgst,r.tax);
a.equal(words(1430000),'INR Fourteen Thousand Three Hundred Rupees Only');
a.equal(words(1580050),'INR Fifteen Thousand Eight Hundred Rupees and Fifty Paise Only');console.log('calc ok');
