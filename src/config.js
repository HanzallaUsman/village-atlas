// ============================================================
//  Village Atlas — content configuration
//  Everything you will edit day-to-day lives in this file:
//  villages, landmark pins, placed 3D models, and UI text.
// ============================================================

export const config = {

  // ----------------------------------------------------------
  // Cloud images (transparent PNGs in assets/images/).
  // Add or remove freely; if none load, soft procedural
  // clouds are used as a fallback.
  // ----------------------------------------------------------
  cloudImages: ['assets/images/cloud04.png', 'assets/images/cloud05.png', 'assets/images/cloud06.png'],

  // ----------------------------------------------------------
  // Sound. woosh plays when a village is selected; birds loop
  // quietly while exploring. Volumes are 0–1.
  // ----------------------------------------------------------
  sounds: {
    woosh: { file: 'assets/audio/sound-woosh.mp3', volume: 0.7 },
    birds: { file: 'assets/audio/sound-birds.mp3', volume: 0.35 },
    // Background music for the falcon flight game.
    flightMusic: { file: 'assets/audio/game-bg-music.mp3', volume: 0.5 },
  },

  // ----------------------------------------------------------
  // Falcon flight mini-game (the "Fly" button while exploring).
  // Mouse steers a bird over the terrain; catch the drifting
  // birds before the timer runs out.
  // ----------------------------------------------------------
  flight: {
    // Your falcon model: drop the .glb in assets/models/ and set it
    // here. Until then a simple placeholder bird is used.
    model: 'assets/models/peregrine-falcon-rigged.glb',
    modelScale: 40,         // tune so the falcon reads from the chase cam
    modelRotationY: Math.PI + 0.1, // 180° to face forward, plus ~5.7° to straighten the nose
    duration: 60,           // seconds per run
    targetCount: 7,         // birds in the air at once
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
      terrain: 'assets/models/masfout-terrain-web.glb',
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
      // Cycling minigame route.
      // Draw it with the admin tool: open the Admin panel (bottom-left),
      // click "Draw route", then click along a road to drop waypoints.
      // Hit "Export route" and paste the array it copies into `route`
      // below (a flat list — no extra [ ]). Heights snap to the terrain.
      // ------------------------------------------------------
      race: {
        bike: 'assets/models/uae-cyclist-animated.glb',
        bikeScale: 5,        // tune so the cyclist reads from the chase cam
        bikeRotationY: -Math.PI / 2, // -90° — turns the model to face forward
        route: [{"x":1006.4,"z":354.8},{"x":1013.4,"z":345.9},{"x":1026.7,"z":337.3},{"x":1040,"z":332.1},{"x":1056.8,"z":321.6},{"x":1077.8,"z":312.1},{"x":1090,"z":296.7},{"x":1088.3,"z":279.7},{"x":1085.1,"z":256.1},{"x":1078.9,"z":209.9},{"x":1071.9,"z":158.9},{"x":1066.6,"z":104.2},{"x":1055.6,"z":26.4},{"x":1051.4,"z":-4.7},{"x":1049.9,"z":-26.1},{"x":1060.8,"z":-33.4},{"x":1067.4,"z":-23.5},{"x":1073.9,"z":-9.6},{"x":1079.3,"z":4.3},{"x":1087.3,"z":15.6},{"x":1092,"z":24.4},{"x":1103.8,"z":14},{"x":1101.4,"z":-14.7},{"x":1098.3,"z":-53.4},{"x":1089.2,"z":-82.2},{"x":1070.2,"z":-101.1},{"x":1050.3,"z":-121.5},{"x":1037.4,"z":-136.8},{"x":1023.2,"z":-156.6},{"x":1004.6,"z":-170.7},{"x":967,"z":-193.5},{"x":929.1,"z":-214.7},{"x":901.8,"z":-245.6},{"x":861.6,"z":-285.3},{"x":845.3,"z":-308.2},{"x":843.9,"z":-341.8},{"x":829,"z":-371.7},{"x":799.9,"z":-385.5},{"x":780.1,"z":-388},{"x":760.8,"z":-411.3},{"x":743.2,"z":-435.6},{"x":725.7,"z":-463.8},{"x":709.4,"z":-497.7},{"x":702.1,"z":-518.9},{"x":660.1,"z":-546.1},{"x":648.3,"z":-571.4},{"x":624.9,"z":-594.1},{"x":583.1,"z":-609.2},{"x":550.3,"z":-617.9},{"x":527.9,"z":-630.3},{"x":494.6,"z":-658.5},{"x":470.3,"z":-658.9},{"x":456.3,"z":-650.1},{"x":458.4,"z":-630.5},{"x":463.4,"z":-614.1},{"x":469.3,"z":-606.5},{"x":480.6,"z":-602.3},{"x":485.1,"z":-600.4},{"x":503.2,"z":-602.6},{"x":516.2,"z":-605.4},{"x":523.4,"z":-609.6},{"x":532.1,"z":-617.8}],           // [{ x, z }, …] filled by the draw tool
      },

      // ------------------------------------------------------
      // Landmark pins. Add entries here.
      // Position: open the site with ?dev appended to the URL,
      // click anywhere on the terrain, and the { x, z } pair is
      // copied to your clipboard. Height snaps to the terrain
      // automatically.
      // ------------------------------------------------------
      // (Masfout Fort now lives in models: below, as a placed 3D model.)
      pins: [],

      // ------------------------------------------------------
      // 3D models placed on the terrain (empty for now).
      // Drop a .glb in assets/models/ and add an entry like:
      //
      // {
      //   url: 'assets/models/watchtower.glb',
      //   x: 300, z: -150,        // position (use ?dev to find it)
      //   yOffset: 0,             // lift above the ground if needed
      //   scale: 10,
      //   rotationY: 0,           // radians
      // },
      // ------------------------------------------------------
      models: [
        {
          id: 'masfout-fort',
          url: 'assets/models/masfout-museum.glb',
          x: 1179.0, z: 256.8,     // the fort's former pin location
          yOffset: 0,
          scale: 3,                // matches al-bomah's air-readable sizing;
                                   // tweak with ?dev if it reads too big/small
          rotationY: 0,

          title: { en: 'Masfout Fort', ar: 'حصن مصفوت' },
          body: {
            en: 'A stone fort overlooking the Masfout valley in the Hajar mountains. Replace this placeholder with the fort’s full story.',
            ar: 'حصن حجري يطل على وادي مصفوت في جبال الحجر. استبدل هذا النص المؤقت بالقصة الكاملة للحصن.',
          },
          images: [],
        },
        {
          id: 'al-bomah-tower',
          url: 'assets/models/al-bomah-tower.glb',
          x: 843.3, z: -194.8,     // from ?dev click
          yOffset: 0,
          scale: 6,                // real tower is 11.4m; oversized so it
                                   // reads from the air, Lewa-style
          rotationY: 0,

          // Clicking the model opens the detail panel with this content.
          title: { en: 'Al Bomah Tower', ar: 'برج البومة' },
          body: {
            en: 'A watchtower overlooking Masfout. This is placeholder text — replace it with the tower’s real story, when it was built, and what visitors can see there.',
            ar: 'برج مراقبة يطل على مصفوت. هذا نص مؤقت — استبدله بقصة البرج الحقيقية وتاريخ بنائه وما يمكن للزوار مشاهدته.',
          },
          // Photos for the panel: first one is the large hero image, the
          // rest form the sliding strip. Drop image files in assets/images/
          // and list them, e.g.  images: ['assets/images/bomah-1.jpg'],
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
      // Falcon flight game
      fly: 'Fly',
      flyScore: 'Score',
      flyTime: 'Time',
      flyHint: 'Move the mouse to steer · Hold to speed up · Catch the birds',
      flyKicker: 'Falcon flight',
      flyPauseTitle: 'End the flight?',
      flyPauseMsg: 'Your run is paused. Resume flying, or end it and return to the map.',
      flyResume: 'Resume',
      flyEnd: 'End flight',
      flyOverTitle: 'Time’s up',
      flyOverMsg: 'birds caught',
      flyAgain: 'Fly again',
      flyDone: 'Back to map',
      // Cycling time-trial race
      race: 'Race',
      raceTime: 'Time',
      raceProgress: 'Progress',
      raceBest: 'Best',
      raceKicker: 'Time trial',
      raceStartHint: 'Tap SPACE or click to pedal — reach the finish!',
      raceFinishTitle: 'Finish!',
      raceNewBest: 'new best!',
      raceAgain: 'Race again',
      raceDone: 'Back to map',
      racePausedTitle: 'Paused',
      raceResume: 'Resume',
      raceNoRoute: 'No route set yet',
      racePedal: 'Pedal',
      raceYou: 'You',
      racePlaced: 'You placed',
      raceOf: 'of',
      raceRival1: 'Abdullah Alblooshi',   // faster rival
      raceRival2: 'Muhammad Alsuwaidi',   // slower rival
      // How-to-steer chooser (shown when you press Fly)
      flyChooseTitle: 'How do you want to steer?',
      flyChooseMsg: 'Head steering uses your webcam — turn your head to fly, open your mouth to dive. You can switch or turn it off anytime.',
      flyChooseHead: 'Head',
      flyChooseMouse: 'Mouse',
      // Head-pose control (opt-in webcam steering)
      headOn: 'Head steer',
      headOff: 'Head steer: on',
      headLoading: 'Starting camera…',
      headCalib: 'Look straight ahead and hold still…',
      headReady: 'Turn your head to steer · Open your mouth to dive',
      headNoFace: 'Move into frame — no face detected',
      headDenied: 'Camera blocked. Allow it in your browser to steer with your head.',
      headUnsupported: 'Head steering isn’t available on this device.',
      headInsecure: 'Head steering needs a secure (HTTPS) or localhost connection for the camera.',
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
      // Falcon flight game
      fly: 'طيران',
      flyScore: 'النقاط',
      flyTime: 'الوقت',
      flyHint: 'حرّك الفأرة للتوجيه · اضغط باستمرار للتسريع · أمسك الطيور',
      flyKicker: 'طيران الصقر',
      flyPauseTitle: 'إنهاء الطيران؟',
      flyPauseMsg: 'تم إيقاف جولتك مؤقتاً. تابع الطيران، أو أنهِه وارجع إلى الخريطة.',
      flyResume: 'متابعة',
      flyEnd: 'إنهاء الطيران',
      flyOverTitle: 'انتهى الوقت',
      flyOverMsg: 'طائر تم اصطياده',
      flyAgain: 'طيران مرة أخرى',
      flyDone: 'العودة إلى الخريطة',
      // Cycling time-trial race
      race: 'سباق',
      raceTime: 'الوقت',
      raceProgress: 'التقدّم',
      raceBest: 'الأفضل',
      raceKicker: 'تجربة زمنية',
      raceStartHint: 'اضغط المسافة أو انقر للدوّاسة — اصعد إلى النهاية!',
      raceFinishTitle: 'النهاية!',
      raceNewBest: 'أفضل رقم جديد!',
      raceAgain: 'سباق مرة أخرى',
      raceDone: 'العودة إلى الخريطة',
      racePausedTitle: 'إيقاف مؤقت',
      raceResume: 'استئناف',
      raceNoRoute: 'لم يتم تعيين مسار بعد',
      racePedal: 'دوّاسة',
      raceYou: 'أنت',
      racePlaced: 'مركزك',
      raceOf: 'من',
      raceRival1: 'عبدالله البلوشي',      // faster rival
      raceRival2: 'محمد السويدي',        // slower rival
      // How-to-steer chooser (shown when you press Fly)
      flyChooseTitle: 'كيف تريد التوجيه؟',
      flyChooseMsg: 'يستخدم التوجيه بالرأس الكاميرا — أدر رأسك للطيران، وافتح فمك للانقضاض. يمكنك التبديل أو الإيقاف في أي وقت.',
      flyChooseHead: 'الرأس',
      flyChooseMouse: 'الفأرة',
      // Head-pose control (opt-in webcam steering)
      headOn: 'التوجيه بالرأس',
      headOff: 'التوجيه بالرأس: مُفعّل',
      headLoading: 'جارٍ تشغيل الكاميرا…',
      headCalib: 'انظر إلى الأمام مباشرةً وابقَ ثابتاً…',
      headReady: 'أدر رأسك للتوجيه · افتح فمك للانقضاض',
      headNoFace: 'ادخل ضمن الإطار — لم يتم اكتشاف وجه',
      headDenied: 'الكاميرا محظورة. اسمح بها في المتصفح للتوجيه بالرأس.',
      headUnsupported: 'التوجيه بالرأس غير متاح على هذا الجهاز.',
      headInsecure: 'يحتاج التوجيه بالرأس إلى اتصال آمن (HTTPS) أو localhost لتشغيل الكاميرا.',
    },
  },
};
