const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Carrega a lista de PINs do arquivo
let listaPins = ["1234"]; // Fallback de segurança caso o arquivo falhe
try {
    listaPins = JSON.parse(fs.readFileSync('./pins.json', 'utf8'));
} catch (err) {
    console.log("Aviso: Arquivo pins.json não encontrado. Usando PIN padrão.");
}

function sortearPin() {
    const index = Math.floor(Math.random() * listaPins.length);
    return String(listaPins[index]);
}

// Estado do jogo (pergunta atual)
let perguntaAtual = "Aguardando os jogadores entrarem...";
let votos = { A: 0, B: 0, C: 0, D: 0 };
let opcoesAtual = { A: "-", B: "-", C: "-", D: "-" };
let usuariosQueVotaram = new Map(); // Armazena quem votou e QUAL opção escolheu
let usuariosConectados = {}; // Armazena dados de quem entrou no jogo
let salaPIN = sortearPin(); // Sorteia um PIN da lista
let timerInterval; // Guarda o intervalo do cronômetro
let tempoRestante = 0; // Tempo em segundos
const TEMPO_MAXIMO = 15; // Defina aqui o tempo de cada pergunta (ex: 15 segundos)
let jogoIniciado = false; // Define se o quiz já começou e tranca a sala
let limiteParticipantes = 60; // Limite padrão máximo de participantes configurável

io.on('connection', (socket) => {
    // Envia o estado atual para quem acabou de conectar
    socket.emit('atualizar-pergunta', { pergunta: perguntaAtual, opcoes: opcoesAtual, votos });
    socket.emit('atualizar-usuarios', Object.values(usuariosConectados)); // Envia a lista atual pro telão
    socket.emit('estado-sala', { pin: salaPIN }); // Envia o PIN da sala para exibir no telão
    socket.emit('atualizar-timer', tempoRestante); // Sincroniza o cronômetro para quem acabou de entrar

    // Garante que o painel admin possa pedir o PIN novamente caso perca o primeiro envio
    socket.on('pedir-pin', () => {
        socket.emit('estado-sala', { pin: salaPIN });
    });

    // Quando o admin muda de pergunta
    socket.on('proxima-pergunta', (dados) => {
        if (dados && dados.pergunta) { // Validação simples
            perguntaAtual = dados.pergunta;
            if (dados.opcoes) opcoesAtual = dados.opcoes;
            votos = { A: 0, B: 0, C: 0, D: 0 }; // reseta os votos
            usuariosQueVotaram.clear(); // libera os usuários para votarem novamente
            io.emit('atualizar-pergunta', { pergunta: perguntaAtual, opcoes: opcoesAtual, votos });
            
            // Inicia o cronômetro
            clearInterval(timerInterval);
            tempoRestante = TEMPO_MAXIMO;
            io.emit('atualizar-timer', tempoRestante);
            
            timerInterval = setInterval(() => {
                tempoRestante--;
                if (tempoRestante >= 0) {
                    io.emit('atualizar-timer', tempoRestante);
                }
                if (tempoRestante === 0) {
                    clearInterval(timerInterval);
                    io.emit('tempo-esgotado'); // Avisa todo mundo que o tempo acabou
                }
            }, 1000);
        }
    });

    // Quando um usuário faz login com nome e avatar
    socket.on('login', (dadosUsuario) => {
        // Valida se o PIN digitado corresponde ao PIN da sala
        if (dadosUsuario.pin !== salaPIN) {
            socket.emit('login-erro', 'PIN incorreto! Verifique o número no telão.');
            return;
        }
        // Bloqueia se o quiz já tiver começado
        if (jogoIniciado) {
            socket.emit('login-erro', 'O jogo já começou! A sala está trancada.');
            return;
        }
        // Bloqueia se a sala estiver cheia (atingiu o limite)
        if (Object.keys(usuariosConectados).length >= limiteParticipantes) {
            socket.emit('login-erro', `A sala está cheia! O limite de ${limiteParticipantes} jogadores foi atingido.`);
            return;
        }
        socket.emit('login-sucesso');
        usuariosConectados[socket.id] = { ...dadosUsuario, pontos: 0 }; // Inicia com 0 pontos
        io.emit('usuario-conectado', dadosUsuario); // Avisa todo mundo que alguém entrou
        io.emit('atualizar-usuarios', Object.values(usuariosConectados)); // Atualiza a lista na lateral
    });

    // Atualiza o limite de jogadores em tempo real (enquanto ainda está no Lobby)
    socket.on('atualizar-limite', (novoLimite) => {
        if (novoLimite > 0) limiteParticipantes = novoLimite;
    });

    // Inicia o jogo, tranca a sala e processa o limite
    socket.on('iniciar-jogo', (dados) => {
        jogoIniciado = true;
        if (dados && dados.limite) limiteParticipantes = dados.limite;
    });

    // Quando um participante vota
    socket.on('votar', (opcao) => {
        // Verifica se o jogo começou, tem tempo, se a opção é válida e se o usuário ainda não votou
        if (jogoIniciado && tempoRestante > 0 && votos[opcao] !== undefined && !usuariosQueVotaram.has(socket.id)) {
            votos[opcao]++;
            usuariosQueVotaram.set(socket.id, opcao); // Registra o voto deste usuário
            io.emit('atualizar-votos', votos); // atualiza o telão em tempo real
        }
    });
    
    // --- FUNÇÕES DE ADMIN ---
    // Avalia quem acertou na rodada atual
    socket.on('avaliar-pergunta', (opcaoCorreta) => {
        clearInterval(timerInterval); // Para o cronômetro se o admin intervir antes de zerar
        
        // 1. Revela a resposta correta para todas as telas piscarem
        io.emit('mostrar-resposta-correta', opcaoCorreta);

        // 2. Aguarda 3 segundos de suspense antes de computar os pontos
        setTimeout(() => {
            usuariosQueVotaram.forEach((opcaoVotada, socketId) => {
                if (opcaoVotada === opcaoCorreta && usuariosConectados[socketId]) {
                    usuariosConectados[socketId].pontos += 10; // Adiciona 10 pontos por acerto
                }
            });
            io.emit('atualizar-usuarios', Object.values(usuariosConectados)); // Atualiza os pontos na tela admin
        }, 3000);
    });

    // Pega o top 3 e envia para a tela final
    socket.on('encerrar-jogo', () => {
        clearInterval(timerInterval);
        
        const rankingCompleto = Object.values(usuariosConectados)
            .sort((a, b) => b.pontos - a.pontos); // Ordena a lista completa do maior pro menor
        io.emit('exibir-podio', rankingCompleto);
    });

    // Reinicia o jogo (Zera tudo e gera novo PIN)
    socket.on('reiniciar-jogo', () => {
        clearInterval(timerInterval);
        tempoRestante = 0;
        perguntaAtual = "Aguardando os jogadores entrarem...";
        votos = { A: 0, B: 0, C: 0, D: 0 };
        opcoesAtual = { A: "-", B: "-", C: "-", D: "-" };
        jogoIniciado = false; // Destranca a sala para um novo jogo
        limiteParticipantes = 60; // Reseta o limite
        usuariosQueVotaram.clear();
        usuariosConectados = {};
        salaPIN = sortearPin(); // Novo PIN sorteado da lista
        
        io.emit('jogo-reiniciado'); // Avisa todos para recarregarem a página
    });

    // Quando o usuário sai/fecha a aba
    socket.on('disconnect', () => {
        if (usuariosConectados[socket.id]) {
            delete usuariosConectados[socket.id];
            io.emit('atualizar-usuarios', Object.values(usuariosConectados)); // Remove o usuário da barra lateral
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});