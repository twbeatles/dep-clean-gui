const fs = require('node:fs');
const path = require('node:path');

async function processIcons() {
    let Jimp;
    try {
        Jimp = require('jimp');
    } catch (e) {
        const { Jimp: JimpClass } = await import('jimp');
        Jimp = JimpClass;
    }

    const srcPath = 'C:/Users/김태완/.gemini/antigravity/brain/f37d81f3-b98c-4bcc-ba2c-f92a230849fd/dep_clean_app_icon_1772514194314.png';
    const destDir = path.join(__dirname, 'electron', 'assets');
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }

    // 1. Electron App Icon (512x512)
    console.log('Reading source image...');
    const image = await Jimp.read(srcPath);

    console.log('Resizing app icon to 512x512...');
    const appIcon = image.clone().background(0x00000000).resize(512, 512); // Resize retaining original transparency
    await appIcon.writeAsync(path.join(destDir, 'icon.png'));
    console.log('Saved app icon to electron/assets/icon.png');

    // 2. Tray Icon Base64 (32x32 transparent circle/rounded or just size down)
    console.log('Creating tray icon (32x32)...');
    const trayIcon = image.clone().resize(32, 32);
    const trayBuffer = await trayIcon.getBufferAsync(Jimp.MIME_PNG);
    const trayBase64 = trayBuffer.toString('base64');
    console.log('TRAY_BASE64_OUTPUT=' + trayBase64);
}

processIcons().catch(console.error);
