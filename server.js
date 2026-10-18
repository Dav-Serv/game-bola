const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

// Menyimpan data setiap room game
const games = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Laptop membuat room
    socket.on('createRoom', () => {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        socket.join(roomId);
        games[roomId] = {
            hostId: socket.id,
            players: [], // [ { id, name, role, score } ]
            choices: { kicker: null, keeper: null },
            round: 1
        };
        socket.emit('roomCreated', roomId);
    });

    // HP join ke room
    socket.on('joinRoom', (roomId, playerName) => {
        const game = games[roomId];
        if (game && game.players.length < 2) {
            socket.join(roomId);
            
            // Pemain 1 jadi Penendang, Pemain 2 jadi Kiper
            const role = game.players.length === 0 ? 'kicker' : 'keeper';
            const newPlayer = { id: socket.id, name: playerName, role: role, score: 0 };
            game.players.push(newPlayer);

            socket.emit('joinSuccess', { roomId, role });
            io.to(roomId).emit('updateLobby', game.players);

            // Jika sudah 2 pemain, mulai game
            if (game.players.length === 2) {
                io.to(roomId).emit('gameStart', game);
            }
        } else {
            socket.emit('joinError', 'Room penuh atau tidak ditemukan');
        }
    });

    // Menerima pilihan arah dari HP
    socket.on('playerChoice', (data) => {
        const { roomId, direction } = data;
        const game = games[roomId];
        if (!game) return;

        const player = game.players.find(p => p.id === socket.id);
        if (!player) return;

        // Simpan pilihan pemain
        game.choices[player.role] = direction;
        io.to(roomId).emit('playerMadeChoice', { role: player.role, name: player.name });

        // Jika keduanya sudah memilih, tentukan hasil
        if (game.choices.kicker && game.choices.keeper) {
            resolveRound(roomId, game);
        }
    });

    function resolveRound(roomId, game) {
        const kickerChoice = game.choices.kicker;
        const keeperChoice = game.choices.keeper;
        const kicker = game.players.find(p => p.role === 'kicker');
        const keeper = game.players.find(p => p.role === 'keeper');

        let resultMsg = "";
        let isGoal = false;

        // Logika Penalti
        if (kickerChoice === keeperChoice) {
            resultMsg = `KIPER MENEPIS!`;
            keeper.score += 1;
        } else {
            resultMsg = `GOOOOLLL!!!`;
            kicker.score += 1;
            isGoal = true;
        }

        // Kirim hasil ke Laptop dan HP
        io.to(roomId).emit('roundResult', {
            msg: resultMsg,
            isGoal: isGoal,
            kickerChoice,
            keeperChoice,
            players: game.players
        });

        // CEK PEMENANG (Skor mencapai 3)
        if (kicker.score >= 3 || keeper.score >= 3) {
            const winner = kicker.score >= 3 ? kicker : keeper;
            
            // Tunggu animasi ronde terakhir selesai (3 detik), lalu umumkan Game Over
            setTimeout(() => {
                io.to(roomId).emit('gameOver', winner);
                
                // Reset skor dan mulai match baru setelah 5 detik
                setTimeout(() => {
                    game.players.forEach(p => p.score = 0);
                    game.round = 1;
                    game.choices = { kicker: null, keeper: null };
                    
                    // Acak peran ulang untuk match baru
                    game.players[0].role = 'kicker';
                    game.players[1].role = 'keeper';
                    
                    io.to(roomId).emit('newRound', game);
                    io.to(roomId).emit('gameStart', game); // Update UI skor ke 0-0
                }, 5000);
            }, 3000);
        } else {
            // Lanjut ke ronde berikutnya jika belum ada yang dapat skor 3
            setTimeout(() => {
                game.choices = { kicker: null, keeper: null };
                game.round += 1;
                
                // Tukar peran
                game.players[0].role = game.players[0].role === 'kicker' ? 'keeper' : 'kicker';
                game.players[1].role = game.players[1].role === 'kicker' ? 'keeper' : 'kicker';
                
                io.to(roomId).emit('newRound', game);
            }, 4000);
        }
    }
});

http.listen(3000, () => {
    console.log('Server berjalan di port 3000');
});