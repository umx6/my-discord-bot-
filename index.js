const {
    Client,
    GatewayIntentBits
} = require('discord.js');

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    NoSubscriberBehavior,
    StreamType
} = require('@discordjs/voice');

const play = require('@iamtraction/play-dl');

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const YTDLP_PATH = '/home/container/node_modules/@distube/yt-dlp/bin/yt-dlp';
const DENO_PATH = '/home/container/.deno/bin/deno';


// =========================
// إعداد البوت
// =========================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const servers = new Map();

function getServerData(guildId) {
    if (!servers.has(guildId)) {
        const player = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Pause
            }
        });

        const data = {
            player,
            connection: null,
            queue: [],
            current: null,
            loop: false,
            playing: false
        };

        servers.set(guildId, data);

        player.on(AudioPlayerStatus.Idle, async () => {
            const server = servers.get(guildId);

            if (!server) return;

            if (server.loop && server.current) {
                await playSong(guildId, server.current);
            } else {
                server.current = null;
                server.playing = false;
                await playNext(guildId);
            }
        });

        player.on('error', error => {
            console.error(`❌ خطأ في مشغل الصوت في ${guildId}:`, error);

            const server = servers.get(guildId);

            if (!server) return;

            server.current = null;
            server.playing = false;

            playNext(guildId);
        });
    }

    return servers.get(guildId);
}

// =========================
// تشغيل الأغنية
// =========================

async function playSong(guildId, song) {
    const server = getServerData(guildId);

    try {
        console.log(`🎵 محاولة تشغيل: ${song.title}`);
        console.log(`🔗 الرابط: ${song.url}`);

        const { spawn } = require('child_process');

        const stream = spawn(YTDLP_PATH, [
    '--cookies', '/home/container/www.youtube.com_cookies (1).txt',
    '--no-playlist',
    '--js-runtimes', `deno:${DENO_PATH}`,
    '-f', 'ba[ext=webm][acodec=opus]',
    '-o', '-',
    song.url
], {


            stdio: ['ignore', 'pipe', 'pipe']
        });

        stream.stderr.on('data', data => {
            console.log(`yt-dlp: ${data.toString().trim()}`);
        });

        stream.on('error', error => {
            console.error('❌ خطأ من yt-dlp:', error);
        });

        const resource = createAudioResource(stream.stdout, {
            inputType: StreamType.WebmOpus
        });

        server.current = song;
        server.playing = true;

        server.player.play(resource);

        if (server.connection) {
            server.connection.subscribe(server.player);
        }

        console.log(`✅ بدأ تشغيل: ${song.title}`);

    } catch (error) {
        console.error('❌ فشل تشغيل الأغنية:', error);
        console.error(error?.stack || error?.message || error);

        server.current = null;
        server.playing = false;

        await playNext(guildId);
    }
}

// =========================
// الأغنية التالية
// =========================

async function playNext(guildId) {
    const server = getServerData(guildId);

    if (!server.queue.length) {
        server.playing = false;
        return;
    }

    const nextSong = server.queue.shift();

    await playSong(guildId, nextSong);
}

// =========================
// البحث عن الأغنية
// =========================

async function searchSong(query) {
    try {
        const results = await play.search(query, {
            limit: 1
        });

        if (!results || !results.length) {
            return null;
        }

        const result = results[0];

        return {
            title: result.title,
            url: result.url,
            duration: result.durationRaw || 'غير معروف'
        };

    } catch (error) {
        console.error('❌ خطأ في البحث:', error);
        return null;
    }
}

// =========================
// تشغيل البوت
// =========================

client.once('ready', () => {
    console.log(`✅ تم تشغيل البوت: ${client.user.tag}`);
});

// =========================
// الأوامر
// =========================

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const content = message.content.trim();
    const guildId = message.guild.id;

    const server = getServerData(guildId);

    // !join
    if (content === '!join') {
        const voiceChannel = message.member.voice.channel;

        if (!voiceChannel) {
            return message.reply('❌ ادخل روم صوتي أولاً.');
        }

        try {
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                selfDeaf: false
            });

            server.connection = connection;

            connection.subscribe(server.player);

            return message.reply(`✅ دخلت روم **${voiceChannel.name}**`);

        } catch (error) {
            console.error(error);
            return message.reply('❌ حصل خطأ أثناء الدخول للروم.');
        }
    }

    // ش اسم الأغنية
    if (content.startsWith('ش ')) {
        const query = content.slice(2).trim();

        if (!query) {
            return message.reply('❌ اكتب اسم الأغنية بعد ش.');
        }

        const voiceChannel = message.member.voice.channel;

        if (!voiceChannel) {
            return message.reply('❌ ادخل روم صوتي أولاً.');
        }

        if (!server.connection) {
            try {
                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: voiceChannel.guild.id,
                    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                    selfDeaf: false
                });

                server.connection = connection;
                connection.subscribe(server.player);

            } catch (error) {
                console.error(error);
                return message.reply('❌ ما قدرت أدخل الروم الصوتي.');
            }
        }

        await message.channel.send(`🔎 أبحث عن: **${query}** ...`);

        const song = await searchSong(query);

        if (!song) {
            return message.reply('❌ ما لقيت الأغنية.');
        }

        server.queue.push(song);

        if (!server.playing) {
            await playNext(guildId);

            return message.channel.send(
                `🎵 الآن: **${song.title}**`
            );
        }

        return message.channel.send(
            `✅ تمت إضافة **${song.title}** إلى قائمة الانتظار.`
        );
    }

    // s = إيقاف مؤقت
    if (content === 's') {
        if (!server.playing) {
            return message.reply('❌ ما فيه أغنية شغالة.');
        }

        server.player.pause();

        return message.reply('⏸️ تم إيقاف الأغنية مؤقتًا.');
    }

    // re = استكمال
    if (content === 're') {
        if (!server.playing) {
            return message.reply('❌ ما فيه أغنية متوقفة مؤقتًا.');
        }

        server.player.unpause();

        return message.reply('▶️ تم استكمال الأغنية.');
    }

    // ss = تخطي
    if (content === 'ss') {
        if (!server.current) {
            return message.reply('❌ ما فيه أغنية شغالة.');
        }

        server.loop = false;
        server.player.stop();

        return message.reply('⏭️ تم تخطي الأغنية.');
    }

    // loop
    if (content === 'loop') {
        if (!server.current) {
            return message.reply('❌ ما فيه أغنية شغالة.');
        }

        server.loop = !server.loop;

        if (server.loop) {
            return message.reply('🔁 تم تشغيل التكرار.');
        } else {
            return message.reply('➡️ تم إيقاف التكرار.');
        }
    }
});

// =========================
// تسجيل الدخول
// =========================

client.login(process.env.TOKEN);
