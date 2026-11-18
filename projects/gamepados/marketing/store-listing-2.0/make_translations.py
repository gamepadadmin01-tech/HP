"""Google Play listing: the 14 extra languages (2026-11-18), the "app is in English for now" note, and one import file.

    python make_translations.py
      -> writes <code>.md for the 14 new languages (same layout as the first 6),
         adds the note to all 20 translated listings (once; safe to run again),
         checks Play's limits (name 30, short 80, full 4000),
         writes projects/gamepados/releases/2.0.0/play-store-graphics/play-translations-20-languages.txt for Play Console's
         "Import translations" box.

Buttons and plan names stay in English ("See why?", "Lifetime") because the app itself is English until 2.1.
"""
import os, re

HERE = os.path.dirname(os.path.abspath(__file__))

NOTES = {
    'zh-CN': '注意：应用目前为英文界面，中文版将在后续更新中推出。',
    'ja-JP': 'ご注意：アプリは現在英語表示です。日本語版は今後のアップデートで対応予定です。',
    'pt-BR': 'Observação: por enquanto o app está em inglês. O português chega em uma próxima atualização.',
    'es-419': 'Nota: por ahora la app está en inglés. El español llegará en una próxima actualización.',
    'id': 'Catatan: untuk saat ini aplikasinya masih berbahasa Inggris. Bahasa Indonesia akan hadir di pembaruan berikutnya.',
    'hi-IN': 'ध्यान दें: अभी ऐप अंग्रेज़ी में है। हिंदी अगले अपडेट में आएगी।',
}

NEW = {}

NEW['es-ES'] = ('Spanish (Spain)', 'Gamepad: Mando para PC',
 'Convierte tu móvil en un mando para PC de baja latencia. Wi-Fi o USB.',
 '''Convierte tu móvil en un mando para PC. GamepadOS hace de tu móvil Android un mando de baja latencia para tu PC con Windows, por Wi-Fi o con un cable USB. Sin receptor y sin hardware extra: tu PC lo reconoce como un mando estándar, así que los juegos compatibles con mando funcionan al momento.

★ CÓMO FUNCIONA
1. Instala el Gamepad Server gratuito en tu PC con Windows 10 u 11 desde gamepad.space.
2. Abre GamepadOS en tu móvil y escanea el código QR, o conéctalo con un cable USB.
3. A jugar. Tu móvil ya es un mando para PC, inalámbrico o con cable.

★ BAJA LATENCIA, WI-FI O USB
• Modo USB para la latencia más baja, de solo unos milisegundos.
• Modo Wi-Fi para jugar sin cables. El Wi-Fi de 5 GHz responde mejor.
• Conexión estable y ayuda clara: si tu PC no responde, toca "See why?" para ver las causas más probables, en orden.

★ UN MANDO DE VERDAD EN TU MÓVIL
• Joysticks analógicos, gatillos, botones superiores, cruceta y botones de acción, con la distribución de un mando de consola.
• Dirección con giroscopio: inclina el móvil para conducir en juegos de carreras.
• Touchpad para mover la cámara o usarlo como ratón.
• Vibración fuerte y precisa en cada pulsación.
• Fluido en pantallas de 90 y 120 Hz.
• Diseños incluidos: Standard y Standard Racing.

★ DISEÑOS PERSONALIZADOS
• Crea tu propio diseño de mando en el editor: mueve, cambia el tamaño y añade botones, joysticks y el touchpad.
• Ajusta la sensibilidad del joystick derecho para girar la cámara más rápido o apuntar con más precisión.
• Haz una copia de seguridad de tus diseños con una cuenta gratuita y recupéralos en un móvil nuevo.

★ JUEGA EN COMPAÑÍA
Conecta hasta cuatro móviles a un PC. Cada móvil es un mando independiente, del Jugador 1 al 4, para multijugador local y cooperativo en el sofá.

★ GRATIS PARA EMPEZAR
GamepadOS se descarga gratis, y cada jugador empieza con tiempo de juego gratuito, sin necesidad de cuenta. Mira un anuncio corto para conseguir más tiempo cuando quieras, o consigue "Lifetime" para jugar sin límite, con un único pago en Google Play. Los anuncios solo aparecen cuando tocas para verlos.

★ PRIVACIDAD ANTE TODO
Lo que haces con el mando va directo de tu móvil a tu PC, por tu propia red o cable. Nunca pasa por nuestros servidores.

★ FUNCIONA CON
• PCs con Windows 10 y Windows 11 con el Gamepad Server gratuito.
• Emuladores y cualquier juego de PC compatible con mando.
• Juegos de carreras, acción, deportes, lucha y plataformas.

¿Necesitas ayuda? Visita gamepad.space/support o usa Contacto en la app. Respondemos a todos los mensajes.

GamepadOS: convierte tu móvil en un mando para PC.''',
 'Nota: de momento la app está en inglés. El español llegará en una próxima actualización.')

NEW['pt-PT'] = ('Portuguese (Portugal)', 'Gamepad: Comando para PC',
 'Transforme o telemóvel num comando para PC de baixa latência. Wi-Fi ou USB.',
 '''Transforme o seu telemóvel num comando para PC. O GamepadOS faz do seu telemóvel Android um comando de baixa latência para o seu PC com Windows, por Wi-Fi ou cabo USB. Sem recetor e sem hardware extra: o PC reconhece-o como um comando normal, por isso os jogos compatíveis com comando funcionam de imediato.

★ COMO FUNCIONA
1. Instale o Gamepad Server gratuito no seu PC com Windows 10 ou 11, a partir de gamepad.space.
2. Abra o GamepadOS no telemóvel e leia o código QR, ou ligue-o com um cabo USB.
3. Jogue. O seu telemóvel é agora um comando para PC, sem fios ou com fios.

★ BAIXA LATÊNCIA, WI-FI OU USB
• Modo USB para a latência mais baixa, de apenas alguns milissegundos.
• Modo Wi-Fi para jogar sem cabos. O Wi-Fi de 5 GHz responde melhor.
• Ligação estável e ajuda clara: se o PC não responder, toque em "See why?" para ver as causas mais prováveis, por ordem.

★ UM COMANDO A SÉRIO NO TELEMÓVEL
• Manípulos analógicos, gatilhos, botões de ombro, direcional e botões de ação, com a disposição de um comando de consola.
• Direção por giroscópio: incline o telemóvel para conduzir em jogos de corridas.
• Touchpad para controlar a câmara ou usar como rato.
• Vibração forte e precisa em cada toque.
• Fluido em ecrãs de 90 e 120 Hz.
• Esquemas incluídos: Standard e Standard Racing.

★ ESQUEMAS PERSONALIZADOS
• Crie o seu próprio esquema no editor: mova, redimensione e adicione botões, manípulos e o touchpad.
• Ajuste a sensibilidade do manípulo direito para rodar a câmara mais depressa ou apontar com mais precisão.
• Faça cópia de segurança dos seus esquemas com uma conta gratuita e recupere-os num telemóvel novo.

★ JOGUEM JUNTOS
Ligue até quatro telemóveis a um PC. Cada telemóvel é um comando independente, do Jogador 1 ao 4, para multijogador local e cooperativo no sofá.

★ GRÁTIS PARA COMEÇAR
O GamepadOS é gratuito para transferir, e cada jogador começa com tempo de jogo grátis, sem precisar de conta. Veja um anúncio curto para ganhar mais tempo quando quiser, ou obtenha o "Lifetime" para jogar sem limites, com um único pagamento no Google Play. Os anúncios só aparecem quando toca para os ver.

★ PRIVACIDADE EM PRIMEIRO LUGAR
Os comandos que faz vão diretamente do telemóvel para o PC, pela sua própria rede ou cabo. Nunca passam pelos nossos servidores.

★ COMPATÍVEL COM
• PCs com Windows 10 e Windows 11 com o Gamepad Server gratuito.
• Emuladores e qualquer jogo de PC compatível com comando.
• Jogos de corridas, ação, desporto, luta e plataformas.

Precisa de ajuda? Visite gamepad.space/support ou use Contacto na app. Respondemos a todas as mensagens.

GamepadOS: transforme o seu telemóvel num comando para PC.''',
 'Nota: de momento a app está em inglês. O português chega numa próxima atualização.')

NEW['zh-TW'] = ('Chinese (Traditional)', 'Gamepad：手機變電腦遊戲手把',
 '把手機變成低延遲的電腦遊戲手把。支援 Wi-Fi 或 USB 連線，不需接收器。',
 '''把你的手機變成電腦遊戲手把。GamepadOS 讓你的 Android 手機透過 Wi-Fi 或 USB 傳輸線，成為 Windows 電腦的低延遲遊戲手把。不需接收器，也不需額外硬體：電腦會把它辨識為標準遊戲手把，支援手把的遊戲都能直接玩。

★ 使用方式
1. 在 Windows 10 或 11 電腦上，從 gamepad.space 安裝免費的 Gamepad Server。
2. 在手機上開啟 GamepadOS，掃描 QR 碼，或用 USB 傳輸線連接。
3. 開始玩。你的手機現在就是無線或有線的電腦遊戲手把。

★ 低延遲，Wi-Fi 或 USB
• USB 模式延遲最低，只有幾毫秒。
• Wi-Fi 模式擺脫線材束縛。5 GHz Wi-Fi 反應最好。
• 連線穩定，說明清楚：如果電腦沒有回應，點「See why?」即可依序查看最可能的原因。

★ 真正的手機手把
• 類比搖桿、扳機鍵、肩鍵、十字鍵與動作按鍵，配置就像遊戲主機手把。
• 陀螺儀轉向：在賽車遊戲中傾斜手機就能轉彎。
• 觸控板可控制視角，也能當滑鼠使用。
• 每次按壓都有強勁清脆的震動。
• 在 90 Hz 與 120 Hz 螢幕上流暢順手。
• 內建配置：Standard 與 Standard Racing。

★ 自訂配置
• 在編輯器中打造自己的手把配置：移動、調整大小，新增按鍵、搖桿與觸控板。
• 調整右搖桿靈敏度，讓視角轉得更快，或瞄準更精準。
• 用免費帳號備份配置，換新手機也能找回來。

★ 一起玩
最多四支手機可連接同一台電腦。每支手機都是獨立的手把，玩家 1 到 4，適合本機多人與同樂合作遊戲。

★ 免費開始
GamepadOS 可免費下載，每位玩家一開始就有免費遊玩時間，不需帳號。想要更多時間時，隨時觀看一則短廣告；或購買「Lifetime」無限暢玩，透過 Google Play 一次付清。只有在你點選觀看時才會出現廣告。

★ 重視隱私
你的手把操作會直接從手機傳到電腦，透過你自己的網路或傳輸線，絕不經過我們的伺服器。

★ 支援
• 安裝免費 Gamepad Server 的 Windows 10 與 Windows 11 電腦。
• 模擬器，以及任何支援遊戲手把的電腦遊戲。
• 賽車、動作、運動、格鬥與平台遊戲。

需要協助嗎？請前往 gamepad.space/support，或使用 App 內的「Contact」。每則訊息我們都會回覆。

GamepadOS：把手機變成電腦的遊戲手把。''',
 '注意：App 目前為英文介面，中文版將在後續更新中推出。')

NEW['ru-RU'] = ('Russian', 'Gamepad: Джойстик для ПК',
 'Превратите телефон в геймпад для ПК с низкой задержкой. Wi-Fi или USB.',
 '''Превратите телефон в геймпад для ПК. GamepadOS делает ваш Android-телефон геймпадом с низкой задержкой для компьютера на Windows — по Wi-Fi или через USB-кабель. Без донгла и дополнительного оборудования: компьютер видит обычный игровой контроллер, поэтому игры с поддержкой геймпада сразу работают.

★ КАК ЭТО РАБОТАЕТ
1. Установите бесплатный Gamepad Server на компьютер с Windows 10 или 11 с сайта gamepad.space.
2. Откройте GamepadOS на телефоне и отсканируйте QR-код или подключитесь USB-кабелем.
3. Играйте. Ваш телефон теперь беспроводной или проводной геймпад для ПК.

★ НИЗКАЯ ЗАДЕРЖКА, WI-FI ИЛИ USB
• Режим USB — минимальная задержка, всего несколько миллисекунд.
• Режим Wi-Fi — игра без проводов. Лучше всего работает Wi-Fi 5 ГГц.
• Стабильное соединение и понятная помощь: если компьютер не отвечает, нажмите «See why?», чтобы увидеть вероятные причины по порядку.

★ НАСТОЯЩИЙ ГЕЙМПАД В ТЕЛЕФОНЕ
• Аналоговые стики, триггеры, бамперы, крестовина и кнопки действий — раскладка как у консольного геймпада.
• Руление гироскопом: наклоняйте телефон, чтобы рулить в гонках.
• Тачпад для управления камерой или как мышь.
• Сильная и чёткая вибрация при каждом нажатии.
• Плавная работа на экранах 90 и 120 Гц.
• Готовые раскладки: Standard и Standard Racing.

★ СВОИ РАСКЛАДКИ
• Создайте свою раскладку в редакторе: перемещайте, меняйте размер и добавляйте кнопки, стики и тачпад.
• Настройте чувствительность правого стика для быстрых поворотов камеры или точного прицеливания.
• Сохраняйте раскладки в бесплатном аккаунте и восстанавливайте их на новом телефоне.

★ ИГРАЙТЕ ВМЕСТЕ
Подключите до четырёх телефонов к одному компьютеру. Каждый телефон — отдельный геймпад, Игрок 1–4, для локального мультиплеера и кооператива на одном диване.

★ БЕСПЛАТНО ДЛЯ НАЧАЛА
GamepadOS можно скачать бесплатно, и каждый игрок сразу получает бесплатное игровое время, без аккаунта. Посмотрите короткую рекламу, чтобы получить больше времени, когда захотите, или купите «Lifetime» для игры без ограничений — один платёж через Google Play. Реклама появляется, только когда вы сами нажимаете, чтобы её посмотреть.

★ КОНФИДЕНЦИАЛЬНОСТЬ
Ваши нажатия идут напрямую с телефона на компьютер — через вашу сеть или кабель. Они никогда не проходят через наши серверы.

★ РАБОТАЕТ С
• Компьютерами на Windows 10 и Windows 11 с бесплатным Gamepad Server.
• Эмуляторами и любыми играми для ПК с поддержкой геймпада.
• Гонками, экшенами, спортивными играми, файтингами и платформерами.

Нужна помощь? Зайдите на gamepad.space/support или нажмите Contact в приложении. Мы отвечаем на каждое сообщение.

GamepadOS: превратите телефон в геймпад для ПК.''',
 'Обратите внимание: пока приложение на английском языке. Русский язык появится в одном из следующих обновлений.')

NEW['tr-TR'] = ('Turkish', 'Gamepad: PC Oyun Kumandası',
 'Telefonunu düşük gecikmeli bir PC oyun kumandasına çevir. Wi-Fi veya USB.',
 '''Telefonunu PC oyun kumandasına çevir. GamepadOS, Android telefonunu Windows bilgisayarın için düşük gecikmeli bir oyun kumandasına dönüştürür; Wi-Fi ya da USB kabloyla. Alıcı yok, ek donanım yok: bilgisayarın onu standart bir oyun kumandası olarak görür, böylece kumanda destekleyen oyunlar hemen çalışır.

★ NASIL ÇALIŞIR
1. Ücretsiz Gamepad Server'ı gamepad.space adresinden Windows 10 veya 11 bilgisayarına kur.
2. Telefonunda GamepadOS'u aç ve QR kodu tara ya da USB kabloyla bağlan.
3. Oyna. Telefonun artık kablosuz ya da kablolu bir PC kumandası.

★ DÜŞÜK GECİKME, WI-FI VEYA USB
• En düşük gecikme için USB modu: sadece birkaç milisaniye.
• Kablosuz özgürlük için Wi-Fi modu. En iyi tepkiyi 5 GHz Wi-Fi verir.
• Kararlı bağlantı ve anlaşılır yardım: bilgisayarın yanıt vermezse "See why?" düğmesine dokun, olası nedenleri sırayla gör.

★ TELEFONUNDA GERÇEK BİR KUMANDA
• Analog çubuklar, tetikler, omuz tuşları, yön tuşları ve aksiyon tuşları; konsol kumandası düzeninde.
• Jiroskopla direksiyon: yarış oyunlarında telefonu eğerek yön ver.
• Kamera kontrolü ya da fare gibi kullanım için touchpad.
• Her basışta güçlü ve net titreşim.
• 90 ve 120 Hz ekranlarda akıcı.
• Hazır düzenler: Standard ve Standard Racing.

★ KENDİ DÜZENİN
• Editörde kendi kumanda düzenini oluştur: tuşları, çubukları ve touchpad'i taşı, boyutlandır ve ekle.
• Sağ çubuğun hassasiyetini ayarla: daha hızlı kamera dönüşleri ya da daha hassas nişan.
• Düzenlerini ücretsiz bir hesapla yedekle, yeni telefonunda geri al.

★ BİRLİKTE OYNA
Tek bir bilgisayara dört telefona kadar bağla. Her telefon ayrı bir kumanda olur, Oyuncu 1'den 4'e, yerel çok oyunculu ve aynı koltukta co-op oyunlar için.

★ BAŞLAMAK ÜCRETSİZ
GamepadOS'u indirmek ücretsiz ve her oyuncu hesap gerekmeden ücretsiz oyun süresiyle başlar. İstediğin zaman kısa bir reklam izleyerek daha fazla süre kazan ya da sınırsız oyun için "Lifetime" al, Google Play üzerinden tek seferlik ödeme. Reklamlar yalnızca izlemek için dokunduğunda görünür.

★ GİZLİLİK ÖNCELİKLİ
Kumanda girişlerin kendi ağın ya da kablon üzerinden doğrudan telefonundan bilgisayarına gider. Asla sunucularımızdan geçmez.

★ UYUMLU OLDUĞU
• Ücretsiz Gamepad Server ile Windows 10 ve Windows 11 bilgisayarlar.
• Emülatörler ve oyun kumandasını destekleyen her PC oyunu.
• Yarış, aksiyon, spor, dövüş ve platform oyunları.

Yardım mı lazım? gamepad.space/support adresini ziyaret et ya da uygulamadaki Contact bölümünü kullan. Her mesaja yanıt veriyoruz.

GamepadOS: telefonunu bilgisayarın için bir oyun kumandasına çevir.''',
 'Not: Uygulama şimdilik İngilizce. Türkçe dil desteği sonraki bir güncellemeyle gelecek.')

NEW['vi'] = ('Vietnamese', 'Gamepad: Tay cầm chơi game PC',
 'Biến điện thoại thành tay cầm chơi game PC độ trễ thấp. Qua Wi-Fi hoặc USB.',
 '''Biến điện thoại thành tay cầm chơi game PC. GamepadOS biến điện thoại Android của bạn thành tay cầm chơi game độ trễ thấp cho máy tính Windows, qua Wi-Fi hoặc cáp USB. Không cần đầu thu, không cần phần cứng thêm: máy tính nhận nó là một tay cầm tiêu chuẩn, nên các game hỗ trợ tay cầm chơi được ngay.

★ CÁCH HOẠT ĐỘNG
1. Cài Gamepad Server miễn phí trên máy tính Windows 10 hoặc 11 từ gamepad.space.
2. Mở GamepadOS trên điện thoại và quét mã QR, hoặc kết nối bằng cáp USB.
3. Chơi thôi. Điện thoại của bạn giờ là tay cầm PC không dây hoặc có dây.

★ ĐỘ TRỄ THẤP, WI-FI HOẶC USB
• Chế độ USB cho độ trễ thấp nhất, chỉ vài mili giây.
• Chế độ Wi-Fi để chơi không cần dây. Wi-Fi 5 GHz cho phản hồi tốt nhất.
• Kết nối ổn định, hướng dẫn rõ ràng: nếu máy tính không phản hồi, chạm "See why?" để xem các nguyên nhân có khả năng nhất, theo thứ tự.

★ TAY CẦM THẬT TRÊN ĐIỆN THOẠI
• Cần analog, cò, nút vai, D-pad và các nút hành động, bố trí như tay cầm máy chơi game.
• Lái bằng con quay hồi chuyển: nghiêng điện thoại để đánh lái trong game đua xe.
• Touchpad để điều khiển góc nhìn hoặc dùng như chuột.
• Rung mạnh và rõ ở mỗi lần bấm.
• Mượt trên màn hình 90 và 120 Hz.
• Bố cục có sẵn: Standard và Standard Racing.

★ BỐ CỤC TÙY CHỈNH
• Tự tạo bố cục tay cầm trong trình chỉnh sửa: di chuyển, đổi kích thước và thêm nút, cần analog và touchpad.
• Chỉnh độ nhạy cần phải để xoay góc nhìn nhanh hơn hoặc ngắm chính xác hơn.
• Sao lưu bố cục bằng tài khoản miễn phí và lấy lại trên điện thoại mới.

★ CHƠI CÙNG NHAU
Kết nối tối đa bốn điện thoại với một máy tính. Mỗi điện thoại là một tay cầm riêng, Người chơi 1 đến 4, cho game nhiều người chơi tại chỗ và co-op.

★ MIỄN PHÍ ĐỂ BẮT ĐẦU
GamepadOS tải về miễn phí, và mỗi người chơi được thời gian chơi miễn phí ngay từ đầu, không cần tài khoản. Xem một quảng cáo ngắn để có thêm thời gian bất cứ lúc nào, hoặc mua "Lifetime" để chơi không giới hạn, thanh toán một lần qua Google Play. Quảng cáo chỉ xuất hiện khi bạn chạm để xem.

★ TÔN TRỌNG QUYỀN RIÊNG TƯ
Thao tác của bạn đi thẳng từ điện thoại đến máy tính qua mạng hoặc cáp của chính bạn. Không bao giờ đi qua máy chủ của chúng tôi.

★ TƯƠNG THÍCH VỚI
• Máy tính Windows 10 và Windows 11 có Gamepad Server miễn phí.
• Trình giả lập và mọi game PC hỗ trợ tay cầm.
• Game đua xe, hành động, thể thao, đối kháng và đi cảnh.

Cần hỗ trợ? Truy cập gamepad.space/support hoặc dùng mục Contact trong ứng dụng. Chúng tôi trả lời mọi tin nhắn.

GamepadOS: biến điện thoại thành tay cầm chơi game cho máy tính.''',
 'Lưu ý: hiện tại ứng dụng đang dùng tiếng Anh. Tiếng Việt sẽ có trong một bản cập nhật sắp tới.')

NEW['ar'] = ('Arabic', 'Gamepad: يد تحكم للكمبيوتر',
 'حوّل هاتفك إلى يد تحكم للكمبيوتر بزمن استجابة منخفض. عبر Wi-Fi أو USB.',
 '''حوّل هاتفك إلى يد تحكم للكمبيوتر. يجعل GamepadOS هاتفك الأندرويد يد تحكم بزمن استجابة منخفض لجهاز الكمبيوتر بنظام Windows، عبر Wi-Fi أو كابل USB. بلا مستقبِل وبلا أجهزة إضافية: يتعرّف الكمبيوتر عليه كيد تحكم عادية، فتعمل الألعاب التي تدعم يد التحكم مباشرة.

★ طريقة العمل
1. ثبّت Gamepad Server المجاني على كمبيوترك بنظام Windows 10 أو 11 من gamepad.space.
2. افتح GamepadOS على هاتفك وامسح رمز QR، أو اتصل بكابل USB.
3. العب. هاتفك الآن يد تحكم للكمبيوتر، لاسلكية أو سلكية.

★ استجابة سريعة، Wi-Fi أو USB
• وضع USB لأقل زمن استجابة، بضع أجزاء من الثانية فقط.
• وضع Wi-Fi للعب بلا أسلاك. شبكة Wi-Fi بتردد 5 GHz تعطي أفضل استجابة.
• اتصال مستقر ومساعدة واضحة: إذا لم يستجب الكمبيوتر، اضغط "See why?" لترى الأسباب المحتملة بالترتيب.

★ يد تحكم حقيقية في هاتفك
• عصا تناظرية، وأزرار زناد، وأزرار كتف، وأسهم اتجاه، وأزرار حركة، بترتيب يد تحكم الكونسول.
• توجيه بالجيروسكوب: أمِل هاتفك لتوجّه السيارة في ألعاب السباق.
• لوحة لمس للتحكم بالكاميرا أو لاستخدامها كفأرة.
• اهتزاز قوي وواضح مع كل ضغطة.
• سلاسة على شاشات 90 و120 هرتز.
• تخطيطات جاهزة: Standard و Standard Racing.

★ تخطيطات مخصّصة
• صمّم تخطيط يد التحكم الخاص بك في المحرر: انقل الأزرار والعصي ولوحة اللمس وغيّر حجمها وأضفها.
• اضبط حساسية العصا اليمنى لتدوير الكاميرا أسرع أو للتصويب بدقة أكبر.
• احفظ نسخة من تخطيطاتك بحساب مجاني واستعدها على هاتف جديد.

★ العبوا معًا
اربط حتى أربعة هواتف بكمبيوتر واحد. كل هاتف يد تحكم مستقلة، من اللاعب 1 إلى 4، لألعاب اللعب الجماعي المحلي والتعاوني.

★ ابدأ مجانًا
تنزيل GamepadOS مجاني، وكل لاعب يبدأ بوقت لعب مجاني دون الحاجة إلى حساب. شاهد إعلانًا قصيرًا لتحصل على وقت إضافي متى شئت، أو احصل على "Lifetime" للعب بلا حدود بدفعة واحدة عبر Google Play. لا تظهر الإعلانات إلا عندما تضغط لمشاهدتها.

★ الخصوصية أولًا
أوامر يد التحكم تنتقل مباشرة من هاتفك إلى الكمبيوتر عبر شبكتك أو كابلك. لا تمرّ أبدًا عبر خوادمنا.

★ يعمل مع
• أجهزة الكمبيوتر بنظام Windows 10 وWindows 11 مع Gamepad Server المجاني.
• المحاكيات وأي لعبة كمبيوتر تدعم يد التحكم.
• ألعاب السباق والأكشن والرياضة والقتال والمنصات.

تحتاج مساعدة؟ زر gamepad.space/support أو استخدم Contact داخل التطبيق. نرد على كل رسالة.

GamepadOS: حوّل هاتفك إلى يد تحكم لجهاز الكمبيوتر.''',
 'ملاحظة: التطبيق باللغة الإنجليزية حاليًا، وستتوفر اللغة العربية في تحديث قادم.')

NEW['ko-KR'] = ('Korean', 'Gamepad: 폰을 PC 게임패드로',
 '휴대폰을 지연 시간이 짧은 PC 게임패드로. Wi-Fi 또는 USB로 연결하세요.',
 '''휴대폰을 PC 게임패드로 바꿔 보세요. GamepadOS는 Android 휴대폰을 Windows PC용 저지연 게임 컨트롤러로 만들어 줍니다. Wi-Fi 또는 USB 케이블로 연결하세요. 동글도, 추가 장비도 필요 없습니다. PC가 표준 게임 컨트롤러로 인식하므로 게임패드를 지원하는 게임은 바로 플레이할 수 있습니다.

★ 사용 방법
1. gamepad.space에서 무료 Gamepad Server를 Windows 10 또는 11 PC에 설치하세요.
2. 휴대폰에서 GamepadOS를 열고 QR 코드를 스캔하거나 USB 케이블로 연결하세요.
3. 플레이하세요. 이제 휴대폰이 무선 또는 유선 PC 게임패드입니다.

★ 짧은 지연 시간, Wi-Fi 또는 USB
• USB 모드는 지연 시간이 가장 짧아 몇 밀리초 수준입니다.
• Wi-Fi 모드로 선 없이 자유롭게 플레이하세요. 5GHz Wi-Fi에서 반응이 가장 좋습니다.
• 안정적인 연결과 친절한 도움말: PC가 응답하지 않으면 "See why?"를 눌러 가능성이 높은 원인을 순서대로 확인하세요.

★ 휴대폰 속 진짜 컨트롤러
• 아날로그 스틱, 트리거, 범퍼, 방향 패드, 액션 버튼을 콘솔 게임패드처럼 배치했습니다.
• 자이로 조향: 레이싱 게임에서 휴대폰을 기울여 핸들을 꺾으세요.
• 카메라 조작이나 마우스처럼 쓰는 터치패드.
• 누를 때마다 강하고 또렷한 진동.
• 90Hz, 120Hz 화면에서도 부드럽게.
• 기본 레이아웃: Standard, Standard Racing.

★ 나만의 레이아웃
• 편집기에서 나만의 컨트롤러 레이아웃을 만드세요. 버튼, 스틱, 터치패드를 옮기고, 크기를 바꾸고, 추가할 수 있습니다.
• 오른쪽 스틱 감도를 조절해 카메라를 더 빠르게 돌리거나 더 정밀하게 조준하세요.
• 무료 계정으로 레이아웃을 백업하고 새 휴대폰에서 그대로 불러오세요.

★ 함께 플레이
PC 한 대에 휴대폰을 최대 4대까지 연결할 수 있습니다. 휴대폰마다 독립된 게임패드(플레이어 1~4)가 되어 로컬 멀티플레이와 협동 게임을 즐길 수 있습니다.

★ 무료로 시작
GamepadOS는 무료로 다운로드할 수 있으며, 모든 플레이어가 계정 없이 무료 플레이 시간으로 시작합니다. 원할 때 짧은 광고를 보고 시간을 더 받거나, "Lifetime"을 구매해 Google Play에서 한 번 결제로 무제한 플레이하세요. 광고는 직접 눌러 볼 때만 나옵니다.

★ 개인정보 보호
컨트롤러 입력은 내 네트워크나 케이블을 통해 휴대폰에서 PC로 바로 전달됩니다. 저희 서버를 거치지 않습니다.

★ 지원 환경
• 무료 Gamepad Server를 설치한 Windows 10, Windows 11 PC.
• 에뮬레이터 및 게임 컨트롤러를 지원하는 모든 PC 게임.
• 레이싱, 액션, 스포츠, 격투, 플랫포머 게임.

도움이 필요하신가요? gamepad.space/support를 방문하거나 앱의 Contact 메뉴를 이용하세요. 모든 메시지에 답장해 드립니다.

GamepadOS: 휴대폰을 PC용 게임패드로.''',
 '참고: 현재 앱은 영어로 제공됩니다. 한국어는 다음 업데이트에서 지원될 예정입니다.')

NEW['th'] = ('Thai', 'Gamepad: จอยเกม PC จากมือถือ',
 'เปลี่ยนมือถือเป็นจอยเกม PC ที่หน่วงต่ำ เชื่อมต่อผ่าน Wi-Fi หรือ USB',
 '''เปลี่ยนมือถือของคุณให้เป็นจอยเกม PC GamepadOS ทำให้มือถือ Android กลายเป็นจอยเกมความหน่วงต่ำสำหรับคอมพิวเตอร์ Windows ผ่าน Wi-Fi หรือสาย USB ไม่ต้องใช้ดองเกิล ไม่ต้องซื้ออุปกรณ์เพิ่ม คอมพิวเตอร์จะมองเห็นเป็นจอยเกมมาตรฐาน เกมที่รองรับจอยจึงเล่นได้ทันที

★ วิธีใช้งาน
1. ติดตั้ง Gamepad Server ฟรีบนคอมพิวเตอร์ Windows 10 หรือ 11 จาก gamepad.space
2. เปิด GamepadOS บนมือถือ แล้วสแกนคิวอาร์โค้ด หรือเชื่อมต่อด้วยสาย USB
3. เล่นได้เลย ตอนนี้มือถือของคุณคือจอยเกม PC แบบไร้สายหรือมีสาย

★ หน่วงต่ำ ผ่าน Wi-Fi หรือ USB
• โหมด USB หน่วงต่ำที่สุด เพียงไม่กี่มิลลิวินาที
• โหมด Wi-Fi เล่นได้อิสระไม่มีสาย Wi-Fi 5 GHz ตอบสนองดีที่สุด
• การเชื่อมต่อเสถียรและมีคำแนะนำชัดเจน ถ้าคอมพิวเตอร์ไม่ตอบสนอง แตะ "See why?" เพื่อดูสาเหตุที่เป็นไปได้มากที่สุดตามลำดับ

★ จอยเกมของจริงบนมือถือ
• อนาล็อกสติก ทริกเกอร์ ปุ่มไหล่ ปุ่มทิศทาง และปุ่มแอ็กชัน จัดวางแบบจอยเครื่องเกมคอนโซล
• บังคับเลี้ยวด้วยไจโร เอียงมือถือเพื่อเลี้ยวในเกมแข่งรถ
• ทัชแพดสำหรับหมุนมุมกล้องหรือใช้แทนเมาส์
• สั่นแรงและชัดทุกครั้งที่กด
• ลื่นไหลบนจอ 90 และ 120 Hz
• เลย์เอาต์ในตัว: Standard และ Standard Racing

★ เลย์เอาต์ที่ปรับได้เอง
• สร้างเลย์เอาต์จอยของคุณเองในตัวแก้ไข ย้าย ปรับขนาด และเพิ่มปุ่ม สติก และทัชแพด
• ปรับความไวของสติกขวา เพื่อหมุนกล้องเร็วขึ้นหรือเล็งได้แม่นขึ้น
• สำรองเลย์เอาต์ด้วยบัญชีฟรี แล้วกู้คืนบนมือถือเครื่องใหม่ได้

★ เล่นด้วยกัน
เชื่อมต่อมือถือได้สูงสุดสี่เครื่องกับคอมพิวเตอร์เครื่องเดียว มือถือแต่ละเครื่องเป็นจอยแยกกัน ผู้เล่น 1 ถึง 4 สำหรับเกมหลายผู้เล่นในเครื่องเดียวและเกมเล่นร่วมกัน

★ เริ่มต้นฟรี
ดาวน์โหลด GamepadOS ได้ฟรี และผู้เล่นทุกคนได้เวลาเล่นฟรีตั้งแต่เริ่ม ไม่ต้องมีบัญชี ดูโฆษณาสั้น ๆ เพื่อรับเวลาเพิ่มได้ทุกเมื่อ หรือซื้อ "Lifetime" เพื่อเล่นได้ไม่จำกัด จ่ายครั้งเดียวผ่าน Google Play โฆษณาจะแสดงเฉพาะเมื่อคุณแตะเพื่อดูเท่านั้น

★ ใส่ใจความเป็นส่วนตัว
การกดปุ่มของคุณส่งตรงจากมือถือไปยังคอมพิวเตอร์ผ่านเครือข่ายหรือสายของคุณเอง ไม่ผ่านเซิร์ฟเวอร์ของเราเลย

★ ใช้งานได้กับ
• คอมพิวเตอร์ Windows 10 และ Windows 11 ที่ติดตั้ง Gamepad Server ฟรี
• อีมูเลเตอร์และเกม PC ทุกเกมที่รองรับจอยเกม
• เกมแข่งรถ แอ็กชัน กีฬา ต่อสู้ และแพลตฟอร์ม

ต้องการความช่วยเหลือ? ไปที่ gamepad.space/support หรือใช้เมนู Contact ในแอป เราตอบทุกข้อความ

GamepadOS: เปลี่ยนมือถือให้เป็นจอยเกมสำหรับคอมพิวเตอร์''',
 'หมายเหตุ: ตอนนี้แอปยังเป็นภาษาอังกฤษ ภาษาไทยจะมาในอัปเดตถัดไป')

NEW['de-DE'] = ('German', 'Gamepad: PC-Controller',
 'Mach dein Handy zum PC-Gamepad mit geringer Latenz. Per WLAN oder USB.',
 '''Mach dein Handy zum PC-Gamepad. GamepadOS verwandelt dein Android-Handy in einen Game-Controller mit geringer Latenz für deinen Windows-PC – per WLAN oder USB-Kabel. Kein Dongle, keine extra Hardware: Dein PC erkennt einen Standard-Controller, also laufen Spiele mit Gamepad-Unterstützung sofort.

★ SO FUNKTIONIERT ES
1. Installiere den kostenlosen Gamepad Server von gamepad.space auf deinem PC mit Windows 10 oder 11.
2. Öffne GamepadOS auf dem Handy und scanne den QR-Code oder verbinde es per USB-Kabel.
3. Spielen. Dein Handy ist jetzt ein kabelloses oder kabelgebundenes PC-Gamepad.

★ GERINGE LATENZ, WLAN ODER USB
• USB-Modus für die geringste Latenz, nur wenige Millisekunden.
• WLAN-Modus für Freiheit ohne Kabel. 5-GHz-WLAN reagiert am besten.
• Stabile Verbindung und klare Hilfe: Antwortet dein PC nicht, tippe auf „See why?“ und sieh die wahrscheinlichsten Ursachen der Reihe nach.

★ EIN ECHTER CONTROLLER AUF DEM HANDY
• Analogsticks, Trigger, Schultertasten, Steuerkreuz und Aktionstasten, angeordnet wie bei einem Konsolen-Gamepad.
• Gyro-Lenkung: Neige dein Handy, um in Rennspielen zu lenken.
• Touchpad für Kamerasteuerung oder als Maus.
• Kräftige, präzise Vibration bei jedem Druck.
• Flüssig auf 90- und 120-Hz-Displays.
• Fertige Layouts: Standard und Standard Racing.

★ EIGENE LAYOUTS
• Bau dein eigenes Controller-Layout im Editor: Tasten, Sticks und Touchpad verschieben, skalieren und hinzufügen.
• Stell die Empfindlichkeit des rechten Sticks ein – für schnellere Kameradrehungen oder genaueres Zielen.
• Sichere deine Layouts mit einem kostenlosen Konto und hol sie dir auf ein neues Handy zurück.

★ GEMEINSAM SPIELEN
Verbinde bis zu vier Handys mit einem PC. Jedes Handy ist ein eigenes Gamepad, Spieler 1 bis 4, für lokalen Multiplayer und Koop auf der Couch.

★ KOSTENLOS STARTEN
GamepadOS ist kostenlos, und jeder Spieler startet mit kostenloser Spielzeit, ganz ohne Konto. Sieh dir jederzeit eine kurze Werbung an, um mehr Zeit zu bekommen, oder hol dir „Lifetime“ für unbegrenztes Spielen, einmal bezahlt über Google Play. Werbung erscheint nur, wenn du tippst, um sie anzusehen.

★ PRIVATSPHÄRE ZUERST
Deine Eingaben gehen direkt vom Handy zum PC, über dein eigenes Netzwerk oder Kabel. Sie laufen nie über unsere Server.

★ FUNKTIONIERT MIT
• PCs mit Windows 10 und Windows 11 und dem kostenlosen Gamepad Server.
• Emulatoren und jedem PC-Spiel, das einen Game-Controller unterstützt.
• Renn-, Action-, Sport-, Kampf- und Jump-’n’-Run-Spielen.

Brauchst du Hilfe? Besuche gamepad.space/support oder nutze Contact in der App. Wir beantworten jede Nachricht.

GamepadOS: Mach dein Handy zum Gamepad für deinen PC.''',
 'Hinweis: Die App ist vorerst auf Englisch. Deutsch kommt mit einem der nächsten Updates.')

NEW['fr-FR'] = ('French', 'Gamepad : Manette pour PC',
 'Transformez votre téléphone en manette PC à faible latence. Wi-Fi ou USB.',
 '''Transformez votre téléphone en manette pour PC. GamepadOS fait de votre téléphone Android une manette à faible latence pour votre PC Windows, en Wi-Fi ou avec un câble USB. Sans dongle ni matériel supplémentaire : votre PC la reconnaît comme une manette standard, donc les jeux compatibles manette fonctionnent tout de suite.

★ COMMENT ÇA MARCHE
1. Installez le Gamepad Server gratuit sur votre PC Windows 10 ou 11 depuis gamepad.space.
2. Ouvrez GamepadOS sur votre téléphone et scannez le QR code, ou branchez un câble USB.
3. Jouez. Votre téléphone est maintenant une manette PC, sans fil ou filaire.

★ FAIBLE LATENCE, WI-FI OU USB
• Mode USB pour la latence la plus faible, quelques millisecondes à peine.
• Mode Wi-Fi pour jouer sans câble. Le Wi-Fi 5 GHz offre la meilleure réactivité.
• Connexion stable et aide claire : si votre PC ne répond pas, appuyez sur « See why? » pour voir les causes les plus probables, dans l'ordre.

★ UNE VRAIE MANETTE DANS VOTRE TÉLÉPHONE
• Sticks analogiques, gâchettes, boutons de tranche, croix directionnelle et boutons d'action, disposés comme sur une manette de console.
• Direction au gyroscope : inclinez le téléphone pour tourner dans les jeux de course.
• Pavé tactile pour la caméra ou comme souris.
• Vibration forte et nette à chaque appui.
• Fluide sur les écrans 90 et 120 Hz.
• Dispositions incluses : Standard et Standard Racing.

★ DISPOSITIONS PERSONNALISÉES
• Créez votre propre disposition dans l'éditeur : déplacez, redimensionnez et ajoutez boutons, sticks et pavé tactile.
• Réglez la sensibilité du stick droit pour tourner la caméra plus vite ou viser plus finement.
• Sauvegardez vos dispositions avec un compte gratuit et retrouvez-les sur un nouveau téléphone.

★ JOUEZ ENSEMBLE
Connectez jusqu'à quatre téléphones à un seul PC. Chaque téléphone est une manette distincte, Joueur 1 à 4, pour le multijoueur local et la coop sur le canapé.

★ GRATUIT POUR COMMENCER
GamepadOS est gratuit à télécharger, et chaque joueur commence avec du temps de jeu offert, sans compte. Regardez une courte pub pour obtenir plus de temps quand vous voulez, ou prenez « Lifetime » pour jouer sans limite, en un seul paiement via Google Play. Les pubs n'apparaissent que si vous appuyez pour en regarder une.

★ RESPECT DE LA VIE PRIVÉE
Vos commandes vont directement du téléphone au PC, par votre propre réseau ou câble. Elles ne passent jamais par nos serveurs.

★ COMPATIBLE AVEC
• Les PC Windows 10 et Windows 11 équipés du Gamepad Server gratuit.
• Les émulateurs et tous les jeux PC compatibles manette.
• Jeux de course, d'action, de sport, de combat et de plateforme.

Besoin d'aide ? Rendez-vous sur gamepad.space/support ou utilisez Contact dans l'application. Nous répondons à chaque message.

GamepadOS : transformez votre téléphone en manette pour votre PC.''',
 "Remarque : l'application est en anglais pour le moment. Le français arrivera dans une prochaine mise à jour.")

NEW['pl-PL'] = ('Polish', 'Gamepad: Pad do PC z telefonu',
 'Zamień telefon w pada do PC z niskim opóźnieniem. Przez Wi-Fi lub USB.',
 '''Zamień telefon w pada do PC. GamepadOS zmienia Twój telefon z Androidem w kontroler o niskim opóźnieniu dla komputera z Windows – przez Wi-Fi lub kabel USB. Bez odbiornika i dodatkowego sprzętu: komputer widzi zwykły kontroler do gier, więc gry obsługujące pada działają od razu.

★ JAK TO DZIAŁA
1. Zainstaluj darmowy Gamepad Server ze strony gamepad.space na komputerze z Windows 10 lub 11.
2. Otwórz GamepadOS na telefonie i zeskanuj kod QR albo połącz się kablem USB.
3. Graj. Twój telefon to teraz bezprzewodowy lub przewodowy pad do PC.

★ NISKIE OPÓŹNIENIE, WI-FI LUB USB
• Tryb USB – najniższe opóźnienie, zaledwie kilka milisekund.
• Tryb Wi-Fi – granie bez kabli. Najlepiej reaguje Wi-Fi 5 GHz.
• Stabilne połączenie i jasna pomoc: jeśli komputer nie odpowiada, dotknij „See why?”, aby zobaczyć najbardziej prawdopodobne przyczyny po kolei.

★ PRAWDZIWY PAD W TELEFONIE
• Gałki analogowe, spusty, bumpery, krzyżak i przyciski akcji w układzie pada konsolowego.
• Kierowanie żyroskopem: przechylaj telefon, aby skręcać w grach wyścigowych.
• Touchpad do sterowania kamerą lub jako mysz.
• Mocne, wyraźne wibracje przy każdym naciśnięciu.
• Płynna praca na ekranach 90 i 120 Hz.
• Gotowe układy: Standard i Standard Racing.

★ WŁASNE UKŁADY
• Zbuduj własny układ pada w edytorze: przesuwaj, zmieniaj rozmiar i dodawaj przyciski, gałki i touchpad.
• Ustaw czułość prawej gałki, aby szybciej obracać kamerę lub celować precyzyjniej.
• Zapisz kopię układów na darmowym koncie i odzyskaj je na nowym telefonie.

★ GRAJCIE RAZEM
Podłącz do czterech telefonów do jednego komputera. Każdy telefon to osobny pad, Gracz 1–4, do lokalnego multiplayera i kooperacji na kanapie.

★ ZACZNIJ ZA DARMO
GamepadOS można pobrać za darmo, a każdy gracz zaczyna z darmowym czasem gry, bez zakładania konta. Obejrzyj krótką reklamę, aby dostać więcej czasu, kiedy chcesz, albo kup „Lifetime”, aby grać bez limitu – jedna płatność przez Google Play. Reklamy pojawiają się tylko wtedy, gdy sam dotkniesz, aby je obejrzeć.

★ PRYWATNOŚĆ PRZEDE WSZYSTKIM
Twoje sterowanie trafia prosto z telefonu do komputera przez Twoją sieć lub kabel. Nigdy nie przechodzi przez nasze serwery.

★ DZIAŁA Z
• Komputerami z Windows 10 i Windows 11 z darmowym Gamepad Server.
• Emulatorami i każdą grą na PC obsługującą kontroler.
• Wyścigami, grami akcji, sportowymi, bijatykami i platformówkami.

Potrzebujesz pomocy? Odwiedź gamepad.space/support lub użyj opcji Contact w aplikacji. Odpowiadamy na każdą wiadomość.

GamepadOS: zamień telefon w pada do swojego PC.''',
 'Uwaga: aplikacja jest na razie po angielsku. Język polski pojawi się w jednej z kolejnych aktualizacji.')

NEW['it-IT'] = ('Italian', 'Gamepad: Controller per PC',
 'Trasforma il telefono in un controller per PC a bassa latenza. Wi-Fi o USB.',
 '''Trasforma il telefono in un controller per PC. GamepadOS rende il tuo telefono Android un controller a bassa latenza per il tuo PC Windows, via Wi-Fi o con un cavo USB. Niente dongle, niente hardware extra: il PC lo riconosce come un normale controller, quindi i giochi che supportano il gamepad funzionano subito.

★ COME FUNZIONA
1. Installa il Gamepad Server gratuito sul tuo PC Windows 10 o 11 da gamepad.space.
2. Apri GamepadOS sul telefono e scansiona il codice QR, oppure collegalo con un cavo USB.
3. Gioca. Il tuo telefono ora è un controller per PC, wireless o via cavo.

★ BASSA LATENZA, WI-FI O USB
• Modalità USB per la latenza più bassa, appena pochi millisecondi.
• Modalità Wi-Fi per giocare senza cavi. Il Wi-Fi a 5 GHz risponde meglio.
• Connessione stabile e aiuto chiaro: se il PC non risponde, tocca "See why?" per vedere le cause più probabili, in ordine.

★ UN VERO CONTROLLER NEL TELEFONO
• Levette analogiche, grilletti, dorsali, croce direzionale e tasti azione, disposti come su un controller da console.
• Sterzo con giroscopio: inclina il telefono per sterzare nei giochi di corse.
• Touchpad per la visuale o da usare come mouse.
• Vibrazione forte e precisa a ogni pressione.
• Fluido sugli schermi a 90 e 120 Hz.
• Layout inclusi: Standard e Standard Racing.

★ LAYOUT PERSONALIZZATI
• Crea il tuo layout nell'editor: sposta, ridimensiona e aggiungi tasti, levette e touchpad.
• Regola la sensibilità della levetta destra per girare la visuale più in fretta o mirare con più precisione.
• Fai il backup dei tuoi layout con un account gratuito e ritrovali su un nuovo telefono.

★ GIOCATE INSIEME
Collega fino a quattro telefoni a un solo PC. Ogni telefono è un controller separato, dal Giocatore 1 al 4, per il multiplayer locale e la co-op sul divano.

★ GRATIS PER INIZIARE
GamepadOS si scarica gratis e ogni giocatore parte con tempo di gioco gratuito, senza bisogno di account. Guarda una breve pubblicità per avere più tempo quando vuoi, oppure prendi "Lifetime" per giocare senza limiti, con un unico pagamento su Google Play. Le pubblicità compaiono solo quando tocchi per guardarne una.

★ PRIVACY PRIMA DI TUTTO
I tuoi comandi vanno direttamente dal telefono al PC, tramite la tua rete o il tuo cavo. Non passano mai dai nostri server.

★ FUNZIONA CON
• PC con Windows 10 e Windows 11 e il Gamepad Server gratuito.
• Emulatori e qualsiasi gioco per PC che supporta un controller.
• Giochi di corse, azione, sport, picchiaduro e platform.

Serve aiuto? Visita gamepad.space/support o usa Contact nell'app. Rispondiamo a ogni messaggio.

GamepadOS: trasforma il telefono in un controller per il tuo PC.''',
 "Nota: per ora l'app è in inglese. L'italiano arriverà con un prossimo aggiornamento.")

NEW['uk'] = ('Ukrainian', 'Gamepad: Джойстик для ПК',
 'Перетворіть телефон на геймпад для ПК з низькою затримкою. Wi-Fi або USB.',
 '''Перетворіть телефон на геймпад для ПК. GamepadOS робить ваш Android-телефон геймпадом із низькою затримкою для комп'ютера з Windows — через Wi-Fi або USB-кабель. Без донгла й додаткового обладнання: комп'ютер бачить звичайний ігровий контролер, тож ігри з підтримкою геймпада працюють одразу.

★ ЯК ЦЕ ПРАЦЮЄ
1. Встановіть безкоштовний Gamepad Server на комп'ютер з Windows 10 або 11 із сайту gamepad.space.
2. Відкрийте GamepadOS на телефоні й відскануйте QR-код або підключіться USB-кабелем.
3. Грайте. Ваш телефон тепер бездротовий або дротовий геймпад для ПК.

★ НИЗЬКА ЗАТРИМКА, WI-FI АБО USB
• Режим USB — мінімальна затримка, лише кілька мілісекунд.
• Режим Wi-Fi — гра без дротів. Найкраще працює Wi-Fi 5 ГГц.
• Стабільне з'єднання й зрозуміла допомога: якщо комп'ютер не відповідає, натисніть «See why?», щоб побачити ймовірні причини по черзі.

★ СПРАВЖНІЙ ГЕЙМПАД У ТЕЛЕФОНІ
• Аналогові стіки, тригери, бампери, хрестовина й кнопки дій — розкладка як у консольного геймпада.
• Кермування гіроскопом: нахиляйте телефон, щоб кермувати в перегонах.
• Тачпад для керування камерою або як миша.
• Сильна й чітка вібрація при кожному натисканні.
• Плавна робота на екранах 90 і 120 Гц.
• Готові розкладки: Standard і Standard Racing.

★ ВЛАСНІ РОЗКЛАДКИ
• Створіть власну розкладку в редакторі: переміщуйте, змінюйте розмір і додавайте кнопки, стіки й тачпад.
• Налаштуйте чутливість правого стіка для швидших поворотів камери або точнішого прицілювання.
• Зберігайте розкладки в безкоштовному акаунті й відновлюйте їх на новому телефоні.

★ ГРАЙТЕ РАЗОМ
Підключіть до чотирьох телефонів до одного комп'ютера. Кожен телефон — окремий геймпад, Гравець 1–4, для локального мультиплеєра й кооперативу на одному дивані.

★ БЕЗКОШТОВНО НА ПОЧАТОК
GamepadOS можна завантажити безкоштовно, і кожен гравець одразу отримує безкоштовний ігровий час, без акаунта. Перегляньте коротку рекламу, щоб отримати більше часу, коли захочете, або придбайте «Lifetime» для гри без обмежень — один платіж через Google Play. Реклама з'являється лише тоді, коли ви самі натискаєте, щоб її переглянути.

★ КОНФІДЕНЦІЙНІСТЬ
Ваші натискання йдуть напряму з телефона на комп'ютер — через вашу мережу або кабель. Вони ніколи не проходять через наші сервери.

★ ПРАЦЮЄ З
• Комп'ютерами з Windows 10 і Windows 11 та безкоштовним Gamepad Server.
• Емуляторами й будь-якими іграми для ПК з підтримкою геймпада.
• Перегонами, екшенами, спортивними іграми, файтингами й платформерами.

Потрібна допомога? Відвідайте gamepad.space/support або натисніть Contact у застосунку. Ми відповідаємо на кожне повідомлення.

GamepadOS: перетворіть телефон на геймпад для ПК.''',
 "Зверніть увагу: поки що застосунок англійською мовою. Українська з'явиться в одному з наступних оновлень.")

ORDER_OLD = [('zh-CN', 'Chinese (Simplified)'), ('ja-JP', 'Japanese'), ('pt-BR', 'Portuguese (Brazil)'),
             ('es-419', 'Spanish (Latin America)'), ('id', 'Indonesian'), ('hi-IN', 'Hindi')]


import json

# 2.1 (2026-11-18): the app itself now speaks every listing language except Arabic. The "app is in English for now"
# note stays only where the app still is English (Arabic); everywhere else it is taken out, and buttons are named by
# the words the app really shows ("See why?" -> the app's translation, "Lifetime" -> the app's translation).
APP_TRANSLATED = True
APP_LOCALES = os.path.join(HERE, '..', '..', 'apps', 'controller-ui', 'src', 'app', 'i18n', 'locales')
OLD_SEE_WHY = {'ja-JP': '原因を見る', 'hi-IN': 'कारण देखें'}   # words the first listings guessed before the app had them


def with_note(full, note, code=''):
    """Put the note just before the 'Need help?' paragraph (the second-to-last paragraph); only once.
    After 2.1 it is removed instead, except for languages the app does not speak (Arabic)."""
    paras = full.strip().split('\n\n')
    if APP_TRANSLATED and code != 'ar':
        return '\n\n'.join(p for p in paras if p != note)
    if note in full: return full
    paras.insert(len(paras) - 2, note)
    return '\n\n'.join(paras)


def app_words(code, full):
    """Name buttons and plans by the words the app shows in that language."""
    p = os.path.join(APP_LOCALES, f'{code}.json')
    if not APP_TRANSLATED or not os.path.exists(p): return full
    d = json.load(open(p, encoding='utf-8'))
    see_why, lifetime = d.get('See why?'), d.get('Lifetime')
    if see_why:
        full = full.replace('See why?', see_why)
        if code in OLD_SEE_WHY: full = full.replace(OLD_SEE_WHY[code], see_why)
    if lifetime:
        full = re.sub(r'(["“„«「])Lifetime(["”“»」])', lambda m: m.group(1) + lifetime + m.group(2), full)
    return full


def read_md(code):
    s = open(os.path.join(HERE, f'{code}.md'), encoding='utf-8').read()
    parts = re.split(r'^## (.*)$', s, flags=re.M)
    head = parts[0]
    f = {parts[i].split('(')[0].strip(): parts[i + 1].strip() for i in range(1, len(parts), 2)}
    return head, f


def write_md(code, name, app, short, full):
    s = (f'# Google Play listing — {name} ({code}) — GamepadOS 2.0\n\n'
         f'Play Console → Store listings → language {code}. Since 2.1 the app speaks this language too (except Arabic), so the listing names its buttons as the app shows them.\n\n'
         f'## App name (30 max)\n\n{app}\n\n## Short description (80 max)\n\n{short}\n\n## Full description (4000 max)\n\n{full}\n')
    open(os.path.join(HERE, f'{code}.md'), 'w', encoding='utf-8', newline='\n').write(s)


rows = []
for code, name in ORDER_OLD:
    head, f = read_md(code)
    full = app_words(code, with_note(f['Full description'], NOTES[code], code))
    s = (head.rstrip() + '\n\n' + f"## App name (30 max)\n\n{f['App name']}\n\n## Short description (80 max)\n\n{f['Short description']}\n\n"
         f"## Full description (4000 max)\n\n{full}\n")
    open(os.path.join(HERE, f'{code}.md'), 'w', encoding='utf-8', newline='\n').write(s)
    rows.append((code, name, f['App name'], f['Short description'], full))
for code, (name, app, short, full, note) in NEW.items():
    full = app_words(code, with_note(full, note, code))
    write_md(code, name, app, short, full)
    rows.append((code, name, app, short, full))

bad = False
for code, name, app, short, full in rows:
    ok = len(app) <= 30 and len(short) <= 80 and len(full) <= 4000
    bad |= not ok
    print(('OK  ' if ok else 'FAIL'), f'{code:7}', f'name {len(app):2}/30  short {len(short):2}/80  full {len(full):4}/4000')
assert not bad

out = ['GamepadOS - Google Play store listing translations (written by the developer, not machine translated).',
       'Each language below has three fields: App name, Short description, Full description. Use the text exactly as written.', '']
for code, name, app, short, full in rows:
    out += ['=' * 60, f'LANGUAGE: {name} - {code}', '=' * 60, '', 'App name:', app, '', 'Short description:', short, '',
            'Full description:', full, '', '']
os.makedirs(os.path.join(HERE, '..', '..', 'releases', '2.1.0'), exist_ok=True)
p = os.path.join(HERE, '..', '..', 'releases', '2.1.0', 'play-translations-20-languages-2.1.txt')
open(p, 'w', encoding='utf-8-sig', newline='\r\n').write('\n'.join(out))
print(p, len(rows), 'languages')
