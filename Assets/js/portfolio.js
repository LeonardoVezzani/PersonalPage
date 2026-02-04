// Lightweight Carousel supporting multiple instances on a page.
// Usage: markup must match the HTML file: .carousel -> .carousel-track -> .carousel-slide elements.
// Each instance initializes itself; images should use loading="lazy" for performance.

(function(){
  function Carousel(root){
    this.root = root;
    this.track = root.querySelector('.carousel-track');
    this.slides = Array.from(this.track.children);
    this.prevBtn = root.querySelector('.carousel-btn.prev');
    this.nextBtn = root.querySelector('.carousel-btn.next');
    this.indicatorRoot = root.querySelector('.carousel-indicators');

    this.index = 0;
    this.total = this.slides.length;

    this.update();
    this.bind();
    this.createIndicators();
    this.updateIndicators();
  }

  Carousel.prototype.update = function(){
    const w = this.root.clientWidth;
    // ensure track translates to show `index`
    const offset = - this.index * (w);
    this.track.style.transform = `translateX(${offset}px)`;
  };

  Carousel.prototype.bind = function(){
    window.addEventListener('resize', this.update.bind(this));

    if(this.prevBtn) this.prevBtn.addEventListener('click', this.prev.bind(this));
    if(this.nextBtn) this.nextBtn.addEventListener('click', this.next.bind(this));

    // keyboard nav when carousel is focused
    this.root.setAttribute('tabindex','0');
    this.root.addEventListener('keydown', (e)=>{
      if(e.key === 'ArrowLeft') this.prev();
      if(e.key === 'ArrowRight') this.next();
    });

    // touch / drag support
    let startX = 0, currentTranslate = 0, dragging = false;
    this.track.addEventListener('pointerdown', (e)=>{
      dragging = true;
      startX = e.clientX;
      this.track.style.transition = 'none';
      this.root.setPointerCapture(e.pointerId);
    });
    window.addEventListener('pointermove', (e)=>{
      if(!dragging) return;
      const dx = e.clientX - startX;
      const w = this.root.clientWidth;
      const offset = - this.index * w + dx;
      this.track.style.transform = `translateX(${offset}px)`;
    });
    window.addEventListener('pointerup', (e)=>{
      if(!dragging) return;
      dragging = false;
      this.track.style.transition = '';
      const dx = e.clientX - startX;
      const w = this.root.clientWidth;
      if(Math.abs(dx) > Math.min(80, w*0.18)){
        if(dx < 0) this.next();
        else this.prev();
      } else {
        this.update();
      }
    });
  };

  Carousel.prototype.prev = function(){
    this.index = Math.max(0, this.index - 1);
    this.update();
    this.updateIndicators();
  };

  Carousel.prototype.next = function(){
    this.index = Math.min(this.total - 1, this.index + 1);
    this.update();
    this.updateIndicators();
  };

  Carousel.prototype.createIndicators = function(){
    if(!this.indicatorRoot) return;
    this.indicatorRoot.innerHTML = '';
    for(let i=0;i<this.total;i++){
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.index = i;
      btn.setAttribute('aria-label', `Go to slide ${i+1}`);
      btn.addEventListener('click', (e)=>{
        this.index = Number(e.currentTarget.dataset.index);
        this.update();
        this.updateIndicators();
      });
      this.indicatorRoot.appendChild(btn);
    }
  };

  Carousel.prototype.updateIndicators = function(){
    if(!this.indicatorRoot) return;
    Array.from(this.indicatorRoot.children).forEach((b, i)=>{
      if(i === this.index) b.setAttribute('aria-current','true');
      else b.removeAttribute('aria-current');
    });
  };

  // Initialize all carousels found on the page
  document.addEventListener('DOMContentLoaded', function(){
    const nodes = document.querySelectorAll('[data-carousel]');
    nodes.forEach(node => new Carousel(node));
  });
})();