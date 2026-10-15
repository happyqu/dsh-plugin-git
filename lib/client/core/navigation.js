// Feature-owned guards, invoked by the shell before leaving an editing surface.
var guards = new Set(), bypass = 0
function registerNavigationGuard(guard) { guards.add(guard); return function () { guards.delete(guard) } }
function requestNavigation(action) {
  if (!bypass) for (var guard of Array.from(guards).reverse()) if (!guard(action)) return false
  return true
}
// A navigation may update several states; nested setters share its approval.
function navigate(action) { if (!requestNavigation(action)) return false; approveNavigation(action); return true }
function approveNavigation(action) { bypass++; try { action() } finally { bypass-- } }
export { registerNavigationGuard, requestNavigation, navigate, approveNavigation }
