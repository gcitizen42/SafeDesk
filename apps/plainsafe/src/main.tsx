// Entry point. Order matters (SPEC §8.1, §12):
// 1. the path-gateway check, which imports nothing and touches neither network nor storage;
// 2. then boot.tsx, whose first import installs netguard before any other module runs.
import { detectPathGateway, renderGatewayRefusal } from './gateway'

const gateway = detectPathGateway(window.location.pathname)
if (gateway) renderGatewayRefusal(document, gateway, window.location.hash)
else void import('./boot')
