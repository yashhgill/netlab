# NetLab

An open-source network simulator for the browser and the desktop. Build a topology of routers, switches and PCs, configure it from an IOS-style command line, and step through every ARP, ICMP and DHCP packet in simulation mode.

![NetLab in simulation mode](site/assets/netlab-screenshot.webp)

**Download:** see the [releases page](https://github.com/yashhgill/netlab/releases) or the download site. **Try it now:** open the browser version from the download site (`/app/`).

## What it simulates

| Area | Supported |
| --- | --- |
| Devices | Router (NL-R3000, 3 × Gigabit), switch (NL-S2400, 24 × Fast + 2 × Gigabit), PC, laptop, server |
| Cabling | Copper straight-through, cross-over and automatic; wrong cable types keep the link down |
| Switching | MAC learning, flooding, filtering, VLANs, 802.1Q trunks, native and allowed VLANs, SVIs |
| Routing | Connected and static routes, default routes, router-on-a-stick sub-interfaces, TTL, ICMP unreachable and time exceeded |
| Services | DHCP pools on routers, DHCP server device, `ip helper-address` relay, APIPA fallback on clients |
| IOS CLI | Modes and prompts, abbreviations, `?` help, Tab completion, history, `do`, `interface range`, `show` commands, passwords, banners, `copy run start`, `reload` |
| PC CLI | `ipconfig` (`/all`, `/release`, `/renew`), `ping` (`-n`, `-t`), `tracert`, `arp -a` |
| Simulation | Pause time, step or play, protocol filters, event list, PDU inspector, Simple PDUs |

Not yet: dynamic routing protocols (RIP, OSPF), STP, ACLs, NAT, wireless, serial links. Contributions are welcome.

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
