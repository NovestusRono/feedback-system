// Classic (non-module) script: runs even when the page's ES modules cannot load.
// Shows a plain explanation instead of a blank page or an endless "Loading...".
(function () {
  function banner(html) {
    if (document.getElementById("ne-boot-banner")) return;
    var d = document.createElement("div");
    d.id = "ne-boot-banner";
    d.setAttribute("role", "alert");
    d.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:99999;background:#fff4e0;color:#1b2a4a;border-bottom:4px solid #e8a33d;padding:14px 18px;font:16px/1.45 system-ui,sans-serif";
    d.innerHTML = html;
    document.documentElement.appendChild(d);
  }
  if (location.protocol === "file:") {
    banner("<strong>This page cannot run from a file on your computer.</strong> Browsers block the app's scripts when you double-click an HTML file. " +
      "Start the local server (<code>node scripts/serve.mjs</code>) and open <code>http://localhost:8080/</code>, or use your GitHub Pages address.");
    return;
  }
  setTimeout(function () {
    if (window.__nyotaLoaded) return;
    banner("<strong>The page could not load its scripts.</strong> Check your internet connection and reload. If you run this site yourself, make sure every file " +
      "(especially the <code>js/</code> and <code>assets/</code> folders) was uploaded, then press F12 and look at the Console for the red error.");
  }, 5000);
})();
