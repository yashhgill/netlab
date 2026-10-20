# NetLab

An open-source network simulator for the browser and the desktop. Build a topology of routers, switches and PCs, configure it from an IOS-style command line, and step through every ARP, ICMP and DHCP packet in simulation mode.

![NetLab in simulation mode](site/assets/netlab-screenshot.webp)

**Download:** see the [releases page](https://github.com/yashhgill/netlab/releases) or the download site. **Try it now:** open the browser version from the download site (`/app/`).

## What it simulates

| Area | Supported |
| --- | --- |
| Routers | NL-R1900 (2 × Gigabit, 2 × serial), NL-R3000 (3 × Gigabit), NL-R2900 (3 × Gigabit, 4 × serial), NL-R4400 (4 × Gigabit, 2 × fiber) |
| Switches | NL-S2400 (24 × Fast, 2 × Gigabit), NL-S2448 (48 × Fast), NL-S2960F (24 × Gigabit, 2 × fiber), NL-S3600 multilayer (24 × Gigabit, 4 × fiber), hub |
| End devices | PC, laptop, server, printer, IP phone |
| Cabling | Automatic, console, copper straight-through and cross-over, fiber, serial DCE and DTE; wrong cable types keep the link down |
| WAN | Serial links that need `clock rate` on the DCE end, HDLC or PPP encapsulation |
| Multilayer | `ip routing`, SVIs, routed ports with `no switchport` |
| Switching | MAC learning, flooding, filtering, VLANs, 802.1Q trunks, native and allowed VLANs, SVIs |
| Routing | Connected and static routes, default routes, router-on-a-stick sub-interfaces, TTL, ICMP unreachable and time exceeded |
| Services | DHCP pools on routers, DHCP server device, `ip helper-address` relay, APIPA fallback on clients |
| Tools | Inspect ARP, MAC and routing tables; power each device on and off; power cycle all; fast forward time; front-panel view with port LEDs; console Terminal on PCs |
| IOS CLI | Modes and prompts, abbreviations, `?` help, Tab completion, history, `do`, `interface range`, `show` commands (including `show cdp neighbors`, `show controllers`, `show run interface`), passwords, banners, `copy run start`, `reload` |
| PC CLI | `ipconfig` (`/all`, `/release`, `/renew`), `ping` (`-n`, `-t`), `tracert`, `arp -a` |
| Simulation | Pause time, step or play, protocol filters, event list, PDU inspector, Simple PDUs |

Not yet: dynamic routing protocols (RIP, OSPF), STP, ACLs, NAT and wireless. Contributions are welcome.

## Project layout

```
app/              the simulator (React + TypeScript + Vite)
  src/engine/     network engine: devices, frames, ARP, IP, switching, DHCP, event scheduler
  src/cli/        IOS-style console and PC command prompt
  src/ui/         workspace, device windows, simulation panel
  src-tauri/      desktop shell (Tauri 2)
site/             download page (static HTML)
.github/workflows CI, website deploy, desktop release builds
```

## Develop

```bash
cd app
npm install
npm run dev        # http://localhost:5173
npm test           # engine and CLI tests
npm run build      # static build in app/dist
```

Desktop app (needs Rust and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)):

```bash
cd app
npm run tauri dev
npm run tauri build
```

## Releasing

1. Bump the version in `app/package.json`, `app/src-tauri/tauri.conf.json` and `app/src-tauri/Cargo.toml`.
2. Push a tag: `git tag v1.0.1 && git push origin v1.0.1`.
3. The Release workflow builds `.dmg` (Apple silicon and Intel), `.exe`, `.msi`, `.AppImage` and `.deb` files and attaches them to a GitHub release. The download page reads the latest release from the GitHub API, so it updates on its own.

## Website

The Website workflow publishes `site/` with the browser build at `/app/` to GitHub Pages on every push to `main`. To serve it at `netlab.harnova.my`, add a CNAME record pointing to `yashhgill.github.io` and set the custom domain in the repository's Pages settings.

## License

MIT. NetLab is an independent project by HarNova Technology and isn't affiliated with or endorsed by any network equipment vendor. All device artwork is original.
