# Liturgia Stream

Liturgia Stream is the standalone streaming companion for Liturgia Worship.

It discovers Liturgia Worship on the local network, receives Program output, combines it with camera, image, and text layers, and sends the finished scene to RTMP or RTMPS destinations through FFmpeg.

## Development

```powershell
npm install
npm test
npm run check
npm start
```

Liturgia Worship must be running on the same local network for Program discovery and source styling.

## Releases

Releases are independent from Liturgia Worship. Bump the version in `package.json` and `package-lock.json`, commit it, then push a matching `vX.Y.Z` tag. GitHub Actions builds the Windows installer and publishes it to that tag's GitHub Release.

## Integration

The app uses Liturgia Worship's `_liturgia-display._tcp` discovery service and its network display receiver. Source-specific styling and transparent Program layers use the Stream receiver bridge protocol introduced with Liturgia Worship 6.1.30.
