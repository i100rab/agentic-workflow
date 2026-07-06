(function () {
  "use strict";

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var header = document.querySelector(".site-header");
  if (header) {
    var onScroll = function () {
      header.classList.toggle("is-scrolled", window.scrollY > 24);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  var navToggle = document.querySelector(".nav-toggle");
  var mainNav = document.querySelector(".main-nav");
  if (navToggle && mainNav) {
    navToggle.addEventListener("click", function () {
      var isOpen = mainNav.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", String(isOpen));
    });
    mainNav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        mainNav.classList.remove("is-open");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  // Scroll-reveal for sections. Guards against anything that renders the
  // page without a real scroll gesture (print, full-page screenshot/crawler
  // capture): reduced motion skips straight to visible, and a timeout
  // safety net force-reveals everything a couple seconds in regardless of
  // whether IntersectionObserver ever fired.
  var revealEls = document.querySelectorAll(".reveal");
  if (revealEls.length) {
    if (reducedMotion || !("IntersectionObserver" in window)) {
      revealEls.forEach(function (el) { el.classList.add("is-visible"); });
    } else {
      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
              observer.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
      );
      revealEls.forEach(function (el, i) {
        el.style.transitionDelay = Math.min(i % 4, 3) * 60 + "ms";
        observer.observe(el);
      });
      window.setTimeout(function () {
        revealEls.forEach(function (el) { el.classList.add("is-visible"); });
      }, 2000);
    }
  }

  // Reservation / contact forms: static front end, no backend wired up yet.
  document.querySelectorAll("form[data-static-form]").forEach(function (form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var status = form.querySelector(".form-status");
      if (status) {
        status.textContent = form.dataset.successMessage || "Thanks — we'll be in touch shortly.";
        status.classList.add("is-visible");
      }
      form.reset();
    });
  });
})();
