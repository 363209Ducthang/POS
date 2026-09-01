(function(){
  'use strict';
  var pages=['dashboard','sale','products','inventory','customers','orders','suppliers','expenses','reports','import','notifications','settings'];
  function show(page){
    if(!pages.includes(page)) return;
    document.querySelectorAll('.page').forEach(function(el){el.classList.toggle('hidden',el.id!=='page-'+page);});
    document.querySelectorAll('.nav[data-page]').forEach(function(el){el.classList.toggle('active',el.getAttribute('data-page')===page);});
    var title=document.getElementById('pageTitle'), sub=document.getElementById('pageSub');
    var t={dashboard:['Tổng quan','Doanh thu, lợi nhuận và hoạt động cửa hàng.'],sale:['Thu ngân','Quét mã, lập đơn và thanh toán.'],products:['Hàng hóa','Quản lý sản phẩm và barcode.'],inventory:['Kho hàng','Nhập hàng và theo dõi tồn kho.'],customers:['Khách hàng','Lịch sử và thông tin khách hàng.'],orders:['Đơn hàng','Theo dõi các giao dịch.'],suppliers:['Nhà cung cấp','Quản lý nguồn hàng.'],expenses:['Chi phí','Theo dõi chi phí cửa hàng.'],reports:['Báo cáo','Doanh thu, giá vốn và lợi nhuận.'],import:['Nhập / Xuất Excel','Nhập xuất dữ liệu hàng hóa.'],notifications:['Thông báo','Cảnh báo tồn kho.'],settings:['Cài đặt','Cấu hình cửa hàng.']}[page];
    if(t){if(title)title.textContent=t[0];if(sub)sub.textContent=t[1];}
    window.__THPOS_BOOT_PAGE=page;
  }
  window.page=show;
  function bind(){
    document.querySelectorAll('.nav[data-page]').forEach(function(b){
      if(b.__bootBound)return; b.__bootBound=true;
      b.addEventListener('click',function(e){e.preventDefault();show(b.getAttribute('data-page'));});
    });
    document.querySelectorAll('[data-quick]').forEach(function(b){
      if(b.__bootBound)return; b.__bootBound=true;
      b.addEventListener('click',function(e){e.preventDefault();show(b.getAttribute('data-quick'));});
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
  window.addEventListener('error',function(e){
    console.error('POS runtime error:',e.error||e.message);
    var box=document.getElementById('toast');
    if(box){box.textContent='Lỗi JavaScript: '+(e.message||'Không xác định');box.style.opacity='1';box.style.background='#b42318';}
  });
})();
