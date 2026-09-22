function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function fitWindowBounds(bounds = {}, workArea = {}) {
  const area = {
    x: finiteNumber(workArea.x, 0),
    y: finiteNumber(workArea.y, 0),
    width: Math.max(1, finiteNumber(workArea.width, 1)),
    height: Math.max(1, finiteNumber(workArea.height, 1)),
  };
  const width = Math.min(area.width, Math.max(1, finiteNumber(bounds.width, 1)));
  const height = Math.min(area.height, Math.max(1, finiteNumber(bounds.height, 1)));
  return {
    x: clamp(finiteNumber(bounds.x, area.x), area.x, area.x + area.width - width),
    y: clamp(finiteNumber(bounds.y, area.y), area.y, area.y + area.height - height),
    width,
    height,
  };
}

function expandedDataDashboardBounds(bounds, workArea, panelWidth = 480) {
  const fitted = fitWindowBounds(bounds, workArea);
  return fitWindowBounds({
    ...fitted,
    width: fitted.width + Math.max(0, finiteNumber(panelWidth, 0)),
  }, workArea);
}

module.exports = { expandedDataDashboardBounds, fitWindowBounds };
