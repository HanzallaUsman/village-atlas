// ============================================================
//  Village Atlas — content configuration
//  Everything you will edit day-to-day lives in this file:
//  villages, landmark pins, placed 3D models, and UI text.
// ============================================================

export const config = {

  // ----------------------------------------------------------
  // Cloud images (transparent PNGs in this folder).
  // Add or remove freely; if none load, soft procedural
  // clouds are used as a fallback.
  // ----------------------------------------------------------
  cloudImages: ['cloud04.png', 'cloud05.png', 'cloud06.png'],

  // ----------------------------------------------------------
  // Sound. woosh plays when a village is selected; birds loop
  // quietly while exploring. Volumes are 0–1.
  // ----------------------------------------------------------
  sounds: {
    woosh: { file: 'sound-woosh.mp3', volume: 0.7 },
    birds: { file: 'sound-birds.mp3', volume: 0.35 },
  },

  // ----------------------------------------------------------
  // Villages shown in the landing index.
  // status: 'live' (clickable) or 'soon' (greyed out).
  // Only 'live' villages need a terrain file.
  // ----------------------------------------------------------
  villages: [
    {
      id: 'masfout',
      status: 'live',
      terrain: 'masfout-terrain-web.glb',
      name: { en: 'Masfout', ar: 'مصفوت' },
      blurb: {
        en: 'A mountain enclave of Ajman in the Hajar range.',
        ar: 'جيب جبلي تابع لإمارة عجمان في سلسلة جبال الحجر.',
      },

      // Camera framing for this terrain (world units).
      // center: point the camera orbits; bounds: how far users may pan.
      view: {
        center: { x: 291, y: 100, z: 165 },
        bounds: { minX: -1500, maxX: 2100, minZ: -1000, maxZ: 1350 },
        topAltitude: 2600,   // altitude of the cloud-deck landing view
                             // (the top-down map view auto-fits to the window)
        closestZoom: 480,    // how near the camera gets at full zoom-in
      },

      // ------------------------------------------------------
      // Landmark pins. Add entries here.
      // Position: open the site with ?dev appended to the URL,
      // click anywhere on the terrain, and the { x, z } pair is
      // copied to your clipboard. Height snaps to the terrain
      // automatically.
      // ------------------------------------------------------
      pins: [
        {
          id: 'masfout-fort',
          x: 1179.0, z: 256.8,
          title: { en: 'Masfout Fort', ar: 'حصن مصفوت' },
          body: {
            en: 'A stone fort overlooking the Masfout valley in the Hajar mountains. Replace this placeholder with the fort’s full story.',
            ar: 'حصن حجري يطل على وادي مصفوت في جبال الحجر. استبدل هذا النص المؤقت بالقصة الكاملة للحصن.',
          },
          images: [],
        },
      ],

      // ------------------------------------------------------
      // 3D models placed on the terrain (empty for now).
      // Drop a .glb in this folder and add an entry like:
      //
      // {
      //   url: 'watchtower.glb',
      //   x: 300, z: -150,        // position (use ?dev to find it)
      //   yOffset: 0,             // lift above the ground if needed
      //   scale: 10,
      //   rotationY: 0,           // radians
      // },
      // ------------------------------------------------------
      models: [
        {
          id: 'al-bomah-tower',
          url: 'al-bomah-tower.glb',
          x: 843.3, z: -194.8,     // from ?dev click
          yOffset: 0,
          scale: 8,                // real tower is 11.4m; oversized so it
                                   // reads from the air, Lewa-style
          rotationY: 0,

          // Clicking the model opens the detail panel with this content.
          title: { en: 'Al Bomah Tower', ar: 'برج البومة' },
          body: {
            en: 'A watchtower overlooking Masfout. This is placeholder text — replace it with the tower’s real story, when it was built, and what visitors can see there.',
            ar: 'برج مراقبة يطل على مصفوت. هذا نص مؤقت — استبدله بقصة البرج الحقيقية وتاريخ بنائه وما يمكن للزوار مشاهدته.',
          },
          // Photos for the panel: first one is the large hero image, the
          // rest form the sliding strip. Drop image files in this folder
          // and list them, e.g.  images: ['bomah-1.jpg', 'bomah-2.jpg'],
          // Empty list = styled placeholders.
          images: [],
        },
      ],
    },

    {
      id: 'qidfa',
      status: 'soon',
      name: { en: 'Qidfa', ar: 'قدفع' },
      blurb: { en: '', ar: '' },
    },
    {
      id: 'al-rams',
      status: 'soon',
      name: { en: 'Al Rams', ar: 'الرمس' },
      blurb: { en: '', ar: '' },
    },
    {
      id: 'al-silaa',
      status: 'soon',
      name: { en: 'Al Silaa', ar: 'السلع' },
      blurb: { en: '', ar: '' },
    },
  ],

  // ----------------------------------------------------------
  // Interface text, English and Arabic.
  // ----------------------------------------------------------
  strings: {
    en: {
      kicker: 'The Emirates from above',
      title: 'Village Atlas',
      tagline: 'Select a village to descend through the clouds.',
      soon: 'Coming soon',
      explore: 'Explore',
      loading: 'Loading terrain',
      back: 'Villages',
      scrollHint: 'Scroll to descend',
      moveHint: 'Drag to move · Scroll to zoom · Right-drag to rotate',
      close: 'Close',
      backToMap: 'Back to map',
      landmark: 'Landmark',
      photoSoon: 'Photograph coming soon',
      copied: 'Position copied',
      soundOn: 'Sound on',
      soundOff: 'Sound off',
      fileProtocol: 'This page needs a local server to load the 3D terrain. Double-click “Start Website.command” in this folder, then use the browser tab it opens.',
      langLabel: 'عربي',
      docTitle: 'Village Atlas — The Emirates from above',
    },
    ar: {
      kicker: 'الإمارات من الأعلى',
      title: 'أطلس القرى',
      tagline: 'اختر قريةً للنزول عبر الغيوم.',
      soon: 'قريباً',
      explore: 'استكشف',
      loading: 'جارٍ تحميل التضاريس',
      back: 'القرى',
      scrollHint: 'مرّر للنزول',
      moveHint: 'اسحب للتنقل · مرّر للتكبير · اسحب بالزر الأيمن للتدوير',
      close: 'إغلاق',
      backToMap: 'العودة إلى الخريطة',
      landmark: 'معلم',
      photoSoon: 'الصورة قريباً',
      copied: 'تم نسخ الموقع',
      soundOn: 'الصوت: تشغيل',
      soundOff: 'الصوت: إيقاف',
      fileProtocol: 'تحتاج هذه الصفحة إلى خادم محلي لتحميل التضاريس ثلاثية الأبعاد. انقر نقراً مزدوجاً على ملف “Start Website.command” في هذا المجلد، ثم استخدم نافذة المتصفح التي تفتح.',
      langLabel: 'EN',
      docTitle: 'أطلس القرى — الإمارات من الأعلى',
    },
  },
};
