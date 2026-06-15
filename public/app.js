// Conecta ao Socket.io servido pelo back-end
const socket = io();

// Elementos do Login
const loginContainer = document.getElementById('login-container');
const quizContainer = document.getElementById('quiz-container');
const podiumContainer = document.getElementById('podium-container');
const podiumPlaces = document.getElementById('podium-places');
const usernameInput = document.getElementById('username-input');
const pinInput = document.getElementById('pin-input');
const toastContainer = document.getElementById('toast-container');
const myAvatarImg = document.getElementById('my-avatar');
const myNameSpan = document.getElementById('my-name');

const timerDisplay = document.getElementById('timer-display');
const questionText = document.getElementById('question-text');
const votesElements = {
    A: document.getElementById('votes-A'),
    B: document.getElementById('votes-B'),
    C: document.getElementById('votes-C'),
    D: document.getElementById('votes-D')
};
const buttons = document.querySelectorAll('.k-btn');
const statusMessage = document.getElementById('status-message');

let voted = false;
let currentUser = null;
let currentAvatarUrl = `https://api.dicebear.com/7.x/adventurer/svg?seed=Convidado`;
let meuVoto = null; // Guarda a opção escolhida pelo jogador

// --- ÁUDIO DE TENSÃO ---
const audioTensao = new Audio('https://actions.google.com/sounds/v1/foley/ticking_clock.ogg');
audioTensao.loop = true; // Deixa o som em loop
audioTensao.volume = 0.3; // Deixa num volume agradável no fundo

// --- SISTEMA DE LOGIN E QR CODE ---

// Preenche o PIN automaticamente se a pessoa entrar pelo QR Code do telão
window.onload = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const pinDaUrl = urlParams.get('pin');
    if (pinDaUrl && pinInput) {
        pinInput.value = pinDaUrl;
        if (usernameInput) usernameInput.focus(); // Já pula direto para o campo de nome
    }
};

// Quando clica em "Entrar no Jogo"
window.entrarJogo = function() {
    const pin = pinInput ? pinInput.value.trim() : '';
    const nome = usernameInput.value.trim();
    
    if (!pin) {
        alert("Por favor, digite o PIN exibido no telão!");
        return;
    }
    if (!nome) {
        alert("Por favor, digite seu nome para entrar!");
        return;
    }
    
    currentUser = { nome: nome, avatar: currentAvatarUrl, pin: pin };
    socket.emit('login', currentUser); // Envia pro servidor
};

socket.on('login-erro', (mensagem) => {
    alert(mensagem);
});

socket.on('login-sucesso', () => {
    loginContainer.style.display = 'none';
    quizContainer.style.display = 'flex';
    
    // Define o avatar e o nome na tela de votação
    if (myAvatarImg) myAvatarImg.src = currentUser.avatar;
    if (myNameSpan) myNameSpan.textContent = currentUser.nome;
    
    // Dá o play na música de tensão (agora é permitido pois o usuário interagiu clicando)
    audioTensao.play().catch(err => console.log("Áudio bloqueado:", err));
});

// Escuta quando novos jogadores entram para exibir a animação no canto
socket.on('usuario-conectado', (usuario) => {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<img src="${usuario.avatar}" alt="${usuario.nome}"> <span>${usuario.nome} entrou!</span>`;
    toastContainer.appendChild(toast);
    
    // Remove a notificação após 3 segundos
    setTimeout(() => {
        toast.style.animation = 'slideOutRight 0.5s forwards';
        setTimeout(() => toast.remove(), 500); // Aguarda terminar de sair para remover do HTML
    }, 3000);
});

// --- LÓGICA DO JOGO ---

// Escuta a atualização de pergunta enviada pelo servidor
socket.on('atualizar-pergunta', (dados) => {
    // Se não for a tela de espera, exibe os botões de votar e toca a música
    if (dados.opcoes && dados.opcoes.A !== "-") {
        document.querySelector('.mobile-button-grid').style.display = 'grid';
        statusMessage.textContent = "👀 Olhe para o telão e vote!";
        audioTensao.currentTime = 0;
        audioTensao.play().catch(err => console.log("Áudio bloqueado:", err));
    } else {
        // Se for a sala de espera inicial, esconde os botões e pausa a música
        document.querySelector('.mobile-button-grid').style.display = 'none';
        statusMessage.textContent = "Você entrou! Aguardando o quiz começar...";
        audioTensao.pause();
    }

    statusMessage.classList.remove('pop');
    void statusMessage.offsetWidth;
    statusMessage.classList.add('pop');

    // Reseta o estado do botão para a nova rodada
    voted = false;
    meuVoto = null;
    
    buttons.forEach(btn => {
        btn.disabled = false;
        btn.classList.remove('voted', 'correct-answer', 'wrong-answer');
    });

    atualizarInterfaceVotos(dados.votos);
});

// Escuta o tique-taque do tempo
socket.on('atualizar-timer', (tempo) => {
    if (tempo > 0) {
        timerDisplay.style.display = 'flex';
        timerDisplay.innerText = tempo;
        if (tempo <= 5) timerDisplay.classList.add('timer-warning');
        else timerDisplay.classList.remove('timer-warning');
    } else {
        timerDisplay.innerText = "0";
    }
});

// Evento para travar a tela quando o tempo acabar
socket.on('tempo-esgotado', () => {
    audioTensao.pause();
    if (!voted) {
        voted = true; // Impede clicar nos botões via HTML
        statusMessage.textContent = "⏰ Tempo esgotado! Aguarde a avaliação.";
        buttons.forEach(btn => btn.disabled = true);
    }
});

// Atualiza os números de votos em tempo real
socket.on('atualizar-votos', (votos) => {
    atualizarInterfaceVotos(votos);
});

function atualizarInterfaceVotos(votos) {
    if (!votos) return;
    for (const [opcao, quantidade] of Object.entries(votos)) {
        if (votesElements[opcao]) {
            const el = votesElements[opcao];
            if (el.textContent !== quantidade.toString()) {
                el.textContent = quantidade;
                // Pisca/anima o número de votos quando ele sobe
                el.classList.remove('pop');
                void el.offsetWidth;
                el.classList.add('pop');
            }
        }
    }
}

// Função engatilhada ao clicar nos botões do HTML
window.votar = function(opcao) {
    if (!voted) {
        meuVoto = opcao;
        socket.emit('votar', opcao); // Envia para o server.js
        voted = true; // Trava no front-end
        statusMessage.textContent = "✔ Voto registrado! Aguarde a próxima pergunta.";
        buttons.forEach(btn => { btn.disabled = true; if (btn.id === `btn-${opcao}`) btn.classList.add('voted'); });
        
        // Para a música de tensão para quem já respondeu
        audioTensao.pause();
    }
};

// Escuta a revelação da resposta correta
socket.on('mostrar-resposta-correta', (opcaoCorreta) => {
    audioTensao.pause(); // Para a música de tensão para quem ainda não votou
    
    buttons.forEach(btn => {
        if (btn.id === `btn-${opcaoCorreta}`) {
            btn.classList.add('correct-answer');
        } else {
            btn.classList.add('wrong-answer');
        }
    });

    if (meuVoto === opcaoCorreta) {
        statusMessage.textContent = "🎉 Acertou! +10 pontos!";
    } else {
        statusMessage.textContent = "❌ Que pena, você errou!";
    }
});

// Escuta o evento do servidor dizendo que o pódio está pronto
socket.on('exibir-podio', (rankingCompleto) => {
    quizContainer.style.display = 'none';
    podiumContainer.style.display = 'block';
    
    const personalResult = document.getElementById('personal-result');
    if (personalResult && currentUser) {
        const myIndex = rankingCompleto.findIndex(u => u.nome === currentUser.nome);
        if (myIndex !== -1) {
            const myRank = myIndex + 1;
            const myPoints = rankingCompleto[myIndex].pontos;
            personalResult.innerHTML = `Você ficou em <span style="color: #FFD700; font-size: 1.5rem;">${myRank}º lugar</span><br>com ${myPoints} pontos!`;
        }
    }

    // Garante que a música de tensão pare no final
    audioTensao.pause();

    // --- EFEITO SONORO DE APLAUSOS ---
    const audioAplausos = new Audio('https://actions.google.com/sounds/v1/crowds/light_applause.ogg');
    audioAplausos.play().catch(err => console.log("Áudio bloqueado pelo navegador:", err));

    // --- EFEITO DE CONFETES ---
    setTimeout(() => {
        const duracaoConfete = 3 * 1000; // 3 segundos
        const fimAnimacao = Date.now() + duracaoConfete;
        const coresPodio = ['#FFD700', '#C0C0C0', '#CD7F32']; // Ouro, Prata e Bronze

        (function dispararConfetes() {
            // Canhão esquerdo
            confetti({ particleCount: 5, angle: 60, spread: 55, origin: { x: 0 }, colors: coresPodio, zIndex: 1000 });
            
            // Canhão direito
            confetti({ particleCount: 5, angle: 120, spread: 55, origin: { x: 1 }, colors: coresPodio, zIndex: 1000 });

            // Continua atirando se o tempo ainda não acabou
            if (Date.now() < fimAnimacao) {
                requestAnimationFrame(dispararConfetes);
            }
        }());
    }, 2500); // Dispara os confetes apenas quando a barra do 1º lugar subir!
    // --------------------------

    podiumPlaces.innerHTML = ''; // Limpa antes de preencher
    
    // Filtra apenas os 3 primeiros para desenhar o pódio visual
    const rankingPodio = rankingCompleto.slice(0, 3);
    
    // Ordem visual do HTML: 2º lugar na esquerda, 1º no meio, 3º na direita
    const visualOrder = [1, 0, 2];
    
    visualOrder.forEach(idx => {
        if (rankingPodio[idx]) {
            const user = rankingPodio[idx];
            const positionClass = idx === 0 ? 'first' : (idx === 1 ? 'second' : 'third');
            const crownHtml = idx === 0 ? '<i class="fa-solid fa-crown crown-icon"></i>' : '';
            podiumPlaces.innerHTML += `
                <div class="podium-place ${positionClass}">
                    ${crownHtml}
                    <img src="${user.avatar}" alt="${user.nome}">
                    <div class="podium-bar"><span>${idx + 1}º</span><span style="font-size:0.7rem">${user.pontos} pts</span></div>
                    <span class="podium-name">${user.nome}</span>
                </div>
            `;
        }
    });
});

// Quando o admin reinicia o jogo, força o celular a recarregar e voltar para a tela de login
socket.on('jogo-reiniciado', () => {
    location.reload();
});