document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM cargado. Iniciando la aplicación.");

    // ====================
    // 1. REFERENCIAS AL DOM
    // ====================
    const refs = {
        main: document.querySelector('main'),
        readerView: document.getElementById('reader-view'),
        vocabView: document.getElementById('vocab-view'),
        navVocabBtn: document.getElementById('nav-vocab-btn'),
        navReaderBtn: document.getElementById('nav-reader-btn'),
        vocabStatusFilter: document.getElementById('vocab-status-filter'),
        vocabSearchInput: document.getElementById('vocab-search-input'),
        vocabTableBody: document.getElementById('vocab-table-body'),
        uploadSection: document.getElementById('upload-section'),
        resultSection: document.getElementById('result-section'),
        langSelect: document.getElementById('lang-select'),
        outputLangSelect: document.getElementById('output-lang-select'),
        loadingSpinner: document.getElementById('loading-spinner'),
        dropArea: document.getElementById('drop-area'),
        fileInput: document.getElementById('file-input'),
        textOutput: document.getElementById('text-output'),
        pageImage: document.getElementById('page-image-view'),
        pageLabel: document.getElementById('page-label'),
        prevBtn: document.getElementById('prev-btn'),
        nextBtn: document.getElementById('next-btn'),
        restartBtn: document.getElementById('restart-btn'),
        popupOverlay: document.getElementById('popup-overlay'),
        translationPopup: document.getElementById('translation-popup'),
        popupCloseBtn: document.getElementById('popup-close-btn'),
        popupWord: document.getElementById('popup-word'),
        popupTranslation: document.getElementById('popup-translation'),
        popupStatusButtons: document.getElementById('popup-status-buttons'),
        playBtn: document.getElementById('play-btn'),
        pauseBtn: document.getElementById('pause-btn'),
        stopBtn: document.getElementById('stop-btn')
    };

    // ========================
    // 2. VARIABLES DE ESTADO
    // ========================
    let state = {
        documentPages: [],
        currentPageIndex: 0,
        synth: window.speechSynthesis,
        currentUtterance: null,
        highlightedWord: null,
        wordSpans: []  // Almacena los spans de palabras para el TTS
    };

    // ====================
    // 3. FUNCIONES PRINCIPALES
    // ====================

    // --------------- Funciones de Utilidad ---------------
    const showToast = (message, type = 'info') => {
        const style = {
            background: type === 'error' 
                ? "linear-gradient(to right, #ff5f6d, #ffc371)" 
                : "linear-gradient(to right, #00b09b, #96c93d)"
        };
        Toastify({ 
            text: message, 
            duration: 3000, 
            close: true, 
            gravity: "top", 
            position: "right", 
            style, 
            stopOnFocus: true 
        }).showToast();
    };

    const showCustomConfirm = (message) => {
        return new Promise((resolve, reject) => {
            const overlay = document.getElementById('custom-confirm-overlay');
            const modal = document.getElementById('custom-confirm-modal');
            const msgElement = document.getElementById('custom-confirm-msg');
            const okBtn = document.getElementById('confirm-ok-btn');
            const cancelBtn = document.getElementById('confirm-cancel-btn');

            msgElement.textContent = message;
            overlay.classList.remove('hidden');
            modal.classList.remove('hidden');

            // Creamos funciones para limpiar y resolver/rechazar
            const cleanupAndResolve = () => {
                overlay.classList.add('hidden');
                modal.classList.add('hidden');
                okBtn.onclick = null;
                cancelBtn.onclick = null;
                resolve();
            };

            const cleanupAndReject = () => {
                overlay.classList.add('hidden');
                modal.classList.add('hidden');
                okBtn.onclick = null;
                cancelBtn.onclick = null;
                reject();
            };

            okBtn.onclick = cleanupAndResolve;
            cancelBtn.onclick = cleanupAndReject;
        });
    };

    // -------------- Gestión de Vistas --------------
    const showReaderView = () => {
        refs.vocabView.classList.add('hidden');
        refs.readerView.classList.remove('hidden');
        refs.navVocabBtn.classList.remove('hidden');
        refs.main.classList.remove('main-expanded');
    };

    const showVocabularyView = async () => {
        refs.readerView.classList.add('hidden');
        refs.vocabView.classList.remove('hidden');
        refs.navVocabBtn.classList.add('hidden');
        refs.main.classList.add('main-expanded');
        await loadAndRenderVocabulary();
    };

    const showUploadView = () => {
        stopTTS();
        refs.resultSection.classList.add('hidden');
        refs.uploadSection.style.display = 'block';
        refs.loadingSpinner.classList.add('hidden');
        refs.dropArea.classList.remove('hidden');
        refs.fileInput.value = '';
        state.documentPages = [];
    };

    const updateView = async () => {
        if (state.documentPages.length === 0) return;
        
        stopTTS();
        const page = state.documentPages[state.currentPageIndex];
        // MODIFICADO: Pasar el objeto text_data en lugar de una cadena de texto
        await renderInteractiveText(page.text_data); 
        
        refs.pageImage.src = `data:image/png;base64,${page.image_b64}`;
        refs.pageLabel.textContent = `Página ${state.currentPageIndex + 1} de ${state.documentPages.length}`;
        refs.prevBtn.disabled = state.currentPageIndex === 0;
        refs.nextBtn.disabled = state.currentPageIndex >= state.documentPages.length - 1;
    };

    // ----------- Inicialización -----------
    const populateVoiceList = () => {
        // 1. Definimos nuestros idiomas prioritarios y CJK
        const priorityLangs = [
            { code: 'es-ES', name: 'Español' },
            { code: 'en-US', name: 'Inglés (EEUU)' },
            { code: 'ja', name: 'Japonés' },
            { code: 'zh-CN', name: 'Chino (Simplificado)' },
            { code: 'ko', name: 'Coreano' }

        ];

        // 2. Detectamos el idioma del navegador del usuario
        const userLang = navigator.language || navigator.userLanguage; // ej: "es-PE" o "en-US"
        
        const voices = state.synth.getVoices();
        refs.langSelect.innerHTML = ''; // Limpiamos el dropdown

        const addedLangs = new Set();
        let bestOptionForUser = null;

        // Función para añadir una opción al select
        const addOption = (value, text) => {
            if (addedLangs.has(value.split('-')[0])) return; // Evita duplicados de base (ej: no añadir es-MX si ya está es-ES)
            
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            refs.langSelect.appendChild(option);
            addedLangs.add(value.split('-')[0]);
        };

        // 3. Buscamos la voz exacta del usuario y la añadimos primero
        const userVoice = voices.find(voice => voice.lang === userLang);
        if (userVoice) {
            addOption(userVoice.lang, `${userVoice.name} (${userVoice.lang})`);
            bestOptionForUser = userVoice.lang;
        }

        // 4. Añadimos nuestros idiomas prioritarios (si no se han añadido ya)
        priorityLangs.forEach(lang => {
            addOption(lang.code, lang.name);
            // Si el idioma del usuario coincide con uno de nuestros prioritarios, lo marcamos para seleccionarlo
            if (!bestOptionForUser && userLang.startsWith(lang.code.split('-')[0])) {
                bestOptionForUser = lang.code;
            }
        });

        // 5. Añadimos el resto de voces del sistema
        voices.forEach(voice => {
            addOption(voice.lang, `${voice.name} (${voice.lang})`);
        });

        // 6. Pre-seleccionamos la mejor opción para el usuario
        if (bestOptionForUser) {
            refs.langSelect.value = bestOptionForUser;
        }
    };


    const populateTranslationLanguages = async () => {
        try {
            const response = await fetch('/get_supported_languages');
            if (!response.ok) throw new Error(`Error del servidor: ${response.statusText}`);
            
            const languages = await response.json();
            refs.outputLangSelect.innerHTML = '';
            
            languages.forEach(lang => {
                const option = document.createElement('option');
                option.textContent = lang.name || lang.language;
                option.value = lang.language;
                refs.outputLangSelect.appendChild(option);
            });
            
            refs.outputLangSelect.value = 'es';
        } catch (e) {
            console.error("Error al cargar idiomas de traducción:", e);
            refs.outputLangSelect.innerHTML = '<option>Error al cargar</option>';
        }
    };

    // ----------- Procesamiento de Archivos -----------
    const handleFile = async (file) => {
        if (!file) return;

        const sourceLangBase = refs.langSelect.value.split('-')[0];
        const targetLangBase = refs.outputLangSelect.value;

        if (sourceLangBase === targetLangBase) {
            const langName = refs.outputLangSelect.options[refs.outputLangSelect.selectedIndex].text;
            const message = `El idioma del documento y el de traducción son el mismo (${langName}).\n\n¿Deseas continuar? (Esto es útil para añadir palabras a tu vocabulario en el mismo idioma).`;
            
            try {
                // Usamos 'await' para esperar a que el usuario haga clic en "Continuar"
                await showCustomConfirm(message);
            } catch {
                // El usuario hizo clic en "Cancelar" o cerró el modal
                refs.fileInput.value = '';
                return; // Detenemos la ejecución
            }
        }

        // Si el usuario confirma (o los idiomas son diferentes), el resto del código se ejecuta.
        refs.dropArea.classList.add('hidden');
        refs.loadingSpinner.classList.remove('hidden');
        
        const formData = new FormData();
        formData.append('file', file);
        formData.append('source_lang', refs.langSelect.value);
        
        try {
            const response = await fetch('/process', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) throw new Error(`Error del servidor: ${response.statusText}`);
            
            const data = await response.json();
            if (data.error) {
                showToast(`Error: ${data.error}`, 'error');
                showUploadView();
                return;
            }
            
            refs.uploadSection.style.display = 'none';
            refs.resultSection.classList.remove('hidden');
            state.documentPages = data.pages;
            state.currentPageIndex = 0;
            await updateView();
        } catch (e) {
            showToast(`Error de conexión: ${e.message}`, 'error');
            showUploadView();
        } finally {
            refs.loadingSpinner.classList.add('hidden');
            refs.dropArea.classList.remove('hidden');
        }
    };

    // ----------- Renderizado de Texto -----------
    const renderInteractiveText = async (text_data) => {
        refs.textOutput.innerHTML = '<div class="loader"></div>';
        
        let words = [];
        let uniqueWords = [];

        // Determinar la lista de palabras/tokens
        if (text_data.type === 'tokenized') {
            words = text_data.tokens.map(w => w.toLowerCase());
        } else if (text_data.type === 'plain') {
            words = text_data.text.split(/[\s,.;:!?]+/).filter(Boolean).map(w => w.toLowerCase());
        }
        
        uniqueWords = [...new Set(words)];
        let wordStatuses = {};

        try {
            const response = await fetch('/get_vocabulary_status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    words: uniqueWords,
                    source_lang: refs.langSelect.value, // <-- Enviar idioma de origen
                    target_lang: refs.outputLangSelect.value 
                })
            });
            if (response.ok) {
                wordStatuses = await response.json();
            }
        } catch (e) {
            console.error("No se pudo obtener el estado del vocabulario:", e);
        }
        
        refs.textOutput.innerHTML = '';
        state.wordSpans = []; // Reiniciar el array de spans

        // Renderizar basado en el tipo de texto
        if (text_data.type === 'tokenized') {
            text_data.tokens.forEach(token => {
                const span = document.createElement('span');
                span.textContent = token;
                span.onclick = () => onWordClick(span);
                state.wordSpans.push(span);

                const cleanToken = token.trim().toLowerCase().replace(/[.,:;!?]$/, '');
                const status = wordStatuses[cleanToken];
                if (status === 'aprendiendo') {
                    span.classList.add('word-learning');
                } else if (status === 'conocida') {
                    span.classList.add('word-known');
                } else {
                    span.classList.add('word-new');
                }
                refs.textOutput.appendChild(span);
            });
        } else { // type === 'plain'
            const parts = text_data.text.split(/(\s+)/);
            parts.forEach(part => {
                const cleanPart = part.trim().toLowerCase().replace(/[.,:;!?]$/, '');
                if (cleanPart.length > 0) {
                    const span = document.createElement('span');
                    span.textContent = part;
                    span.onclick = () => onWordClick(span);
                    state.wordSpans.push(span);

                    const status = wordStatuses[cleanPart];
                    if (status === 'aprendiendo') {
                        span.classList.add('word-learning');
                    } else if (status === 'conocida') {
                        span.classList.add('word-known');
                    } else {
                        span.classList.add('word-new');
                    }
                    refs.textOutput.appendChild(span);
                } else {
                    refs.textOutput.appendChild(document.createTextNode(part));
                }
            });
        }
    };

    // ----------- Gestión de Vocabulario -----------

    const loadAndRenderVocabulary = async () => {
    const status = refs.vocabStatusFilter.value;
    refs.vocabTableBody.innerHTML = `<tr><td colspan="5">Cargando...</td></tr>`;
    
    try {
        const response = await fetch(`/get_vocabulary?status=${status}`);
        const vocabulary = await response.json();
        refs.vocabTableBody.innerHTML = '';
        
        if (vocabulary.length === 0) {
            refs.vocabTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;">No hay palabras.</td></tr>`;
            return;
        }
        
        vocabulary.forEach(word => {
            const row = document.createElement('tr');
            // Guardar todos los identificadores en la fila
            row.dataset.word = word.word_text;
            row.dataset.sourceLang = word.source_language;
            row.dataset.targetLang = word.target_language;
            
            const statusClass = `status-${word.learning_status}`;
            // MODIFICADO: Mostrar ambos idiomas
            const langDisplay = `${word.source_language.toUpperCase()} → ${word.target_language.toUpperCase()}`;
            
            row.innerHTML = `
                <td>${word.word_text}</td>
                <td>${word.translation}</td>
                <td>${langDisplay}</td>
                <td><span class="status-badge ${statusClass}">${word.learning_status}</span></td>
                <td>
                    <button class="action-btn" data-action="edit">✏️</button>
                    <button class="action-btn" data-action="delete">🗑️</button>
                </td>
            `;
            
            refs.vocabTableBody.appendChild(row);
        });
        
        filterVocabularyTable();
    } catch (e) {
        refs.vocabTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Error al cargar.</td></tr>`;
    }
};

    const filterVocabularyTable = () => {
        const searchTerm = refs.vocabSearchInput.value.trim().toLowerCase();
        const hasSearchTerm = searchTerm.length > 0;
        
        refs.vocabTableBody.querySelectorAll('tr').forEach(row => {
            if (!row.cells[0] || !row.cells[1]) {
                row.style.display = 'none';
                return;
            }
            
            if (!hasSearchTerm) {
                row.style.display = '';
                return;
            }
            
            const wordText = row.cells[0].textContent.toLowerCase();
            const translationText = row.cells[1].textContent.toLowerCase();
            
            const shouldShow = wordText.includes(searchTerm) || 
                              translationText.includes(searchTerm);
            
            row.style.display = shouldShow ? '' : 'none';
        });
    };

    const handleTableActions = (event) => {
        const button = event.target.closest('.action-btn');
        if (!button) return;
        
        const action = button.dataset.action;
        const row = button.closest('tr');
        const word = row.dataset.word;
        const lang = row.dataset.lang;
        
        if (action === 'delete') {
            if (confirm(`¿Eliminar "${word}"?`)) {
                deleteWordFromDB(word, lang, row);
            }
        } else if (action === 'edit') {
            const currentTranslation = row.cells[1].textContent;
            const newTranslation = prompt(`Editar traducción para "${word}":`, currentTranslation);
            
            if (newTranslation && newTranslation !== currentTranslation) {
                editWordInDB(word, newTranslation, lang, row);
            }
        }
    };

    const deleteWordFromDB = async (word, lang, row) => {
        try {
            const response = await fetch('/delete_word', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    word, 
                    target_lang: lang 
                })
            });
            
            if (!response.ok) throw new Error('Error del servidor');
            row.remove();
            showToast(`'${word}' eliminada.`, 'info');
        } catch (e) {
            showToast('No se pudo eliminar la palabra.', 'error');
        }
    };

    const editWordInDB = async (word, newTranslation, lang, row) => {
        try {
            const response = await fetch('/edit_word', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    word, 
                    translation: newTranslation, 
                    target_lang: lang 
                })
            });
            
            if (!response.ok) throw new Error('Error del servidor');
            row.cells[1].textContent = newTranslation;
            showToast(`'${word}' actualizada.`, 'info');
        } catch (e) {
            showToast('No se pudo editar la palabra.', 'error');
        }
    };

    // ----------- Traducción y Popup -----------

const onWordClick = async (spanElement) => {
    const cleanWord = spanElement.textContent.replace(/[.,:;!?]$/, '').trim();
    if (!cleanWord) return;

    // --- LÓGICA PARA ENCONTRAR LA FRASE COMPLETA ---
    let fullSentence = '';
    // Reconstruimos la frase a partir de los nodos de texto y spans alrededor del clicado
    let currentNode = spanElement;
    let sentenceParts = [spanElement.textContent];
    
    // Hacia atrás hasta encontrar un punto
    while ((currentNode = currentNode.previousSibling)) {
        if (currentNode.textContent.includes('.')) {
            sentenceParts.unshift(currentNode.textContent.split('.').pop());
            break;
        }
        sentenceParts.unshift(currentNode.textContent);
    }
    
    // Hacia adelante hasta encontrar un punto
    currentNode = spanElement;
    while ((currentNode = currentNode.nextSibling)) {
        sentenceParts.push(currentNode.textContent);
        if (currentNode.textContent.includes('.')) {
            break;
        }
    }
    fullSentence = sentenceParts.join('').trim();
    // --- FIN DE LA LÓGICA DE LA FRASE ---

    const sourceLang = refs.langSelect.value;
    
    refs.popupStatusButtons.dataset.currentWord = cleanWord.toLowerCase();
    refs.popupStatusButtons.dataset.currentSourceLang = sourceLang;
    refs.popupStatusButtons.dataset.currentSpanIndex = Array.from(
        refs.textOutput.querySelectorAll('span')
    ).indexOf(spanElement);
    
    showPopup('Traduciendo...');
    
    try {
        const response = await fetch('/translate', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                word: cleanWord, 
                sentence: fullSentence, // <-- ENVIAMOS LA FRASE COMPLETA
                source_lang: sourceLang,
                target_lang: refs.outputLangSelect.value 
            })
        });
        
        const data = await response.json();
        if (data.error) {
            updatePopupContent(`Error: ${data.error}`);
        } else {
            // Pasamos los nuevos datos a la función que actualiza el popup
            updatePopupContent(data.translation, cleanWord, data.status, data.source_sentence, data.translated_sentence);
        }
    } catch (e) {
        updatePopupContent(`Error de red: ${e.message}`);
    }
};


const handleStatusChange = async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    
    const newStatus = button.dataset.status;
    const word = refs.popupStatusButtons.dataset.currentWord;
    const sourceLang = refs.popupStatusButtons.dataset.currentSourceLang; // <-- Obtener idioma de origen
    const spanIndex = parseInt(refs.popupStatusButtons.dataset.currentSpanIndex, 10);
    
    try {
        const response = await fetch('/update_word_status', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                word,
                source_lang: sourceLang, // <-- Enviar idioma de origen
                target_lang: refs.outputLangSelect.value, 
                status: newStatus 
            })
        });
        
        if (response.ok) {
            showToast(`'${word}' marcada como '${newStatus}'`, 'info');
            updateActiveButton(newStatus);
            updateWordSpanClass(spanIndex, newStatus);
        }
    } catch (e) {
        console.error("Error al actualizar el estado:", e);
    }
};

    const showPopup = (content) => {
        updatePopupContent(content);
        refs.popupOverlay.classList.remove('hidden');
        refs.translationPopup.classList.remove('hidden');
    };

    const hidePopup = () => {
        refs.popupOverlay.classList.add('hidden');
        refs.translationPopup.classList.add('hidden');
    };

    const updatePopupContent = (translation, word = '', status = '', sourceSentence = '', translatedSentence = '') => {
        refs.popupWord.textContent = word;
        refs.popupTranslation.textContent = translation || 'N/A';
        if (status) updateActiveButton(status);

        const contextSection = document.getElementById('context-section');
        const popupSourceSentence = document.getElementById('popup-source-sentence');
        const popupTranslatedSentence = document.getElementById('popup-translated-sentence');

        // Muestra la sección de contexto solo si tenemos las frases
        if (sourceSentence && translatedSentence) {
            popupSourceSentence.textContent = sourceSentence;
            popupTranslatedSentence.textContent = translatedSentence;
            contextSection.classList.remove('hidden');
        } else {
            contextSection.classList.add('hidden');
        }
    };

    const updateActiveButton = (activeStatus) => {
        refs.popupStatusButtons.querySelectorAll('button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.status === activeStatus);
        });
    };

    const updateWordSpanClass = (spanIndex, status) => {
        const span = refs.textOutput.querySelectorAll('span')[spanIndex];
        if (!span) return;
        
        // Limpiamos todas las clases de estado
        span.classList.remove('word-new', 'word-learning', 'word-known');
        
        // Aplicamos la clase correspondiente
        if (status === 'aprendiendo') {
            span.classList.add('word-learning');
        } else if (status === 'conocida') {
            span.classList.add('word-known');
        } else {
            span.classList.add('word-new');
        }
    };

    // ----------- Texto a Voz (TTS) -----------
    const highlightWord = (span) => {
        // Limpiar highlight anterior
        if (state.highlightedWord) {
            state.highlightedWord.classList.remove('highlight');
        }
        
        // Aplicar nuevo highlight
        span.classList.add('highlight');
        state.highlightedWord = span;
        
        // Scroll a la palabra
        span.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'nearest', 
            inline: 'center' 
        });
    };

    const playTTS = () => {
        if (state.synth.speaking && state.synth.paused) {
            state.synth.resume();
            return;
        }
        
        stopTTS();
        
        // MODIFICADO: Usar la clave 'full_text' para el TTS
        const textToSpeak = state.documentPages[state.currentPageIndex].full_text; 
        if (!textToSpeak) {
            showToast("No hay texto para leer.", "error");
            return;
        }

        state.currentUtterance = new SpeechSynthesisUtterance(textToSpeak);
        state.currentUtterance.lang = refs.langSelect.value;
        
        // Preparamos un array con los límites de cada palabra
        const wordBoundaries = [];
        let currentPosition = 0;
        
        // Recorremos los spans para calcular los límites
        state.wordSpans.forEach(span => {
            const word = span.textContent.trim();
            if (word) {
                wordBoundaries.push({
                    start: currentPosition,
                    end: currentPosition + word.length,
                    span: span
                });
                currentPosition += word.length + 1; // +1 por el espacio
            }
        });
        
        state.currentUtterance.onboundary = (event) => {
            if (event.name !== 'word') return;
            
            const charIndex = event.charIndex;
            // Buscamos el span que contiene este índice de carácter
            const currentWord = wordBoundaries.find(boundary => 
                charIndex >= boundary.start && charIndex < boundary.end
            );
            
            if (currentWord) {
                highlightWord(currentWord.span);
            }
        };
        
        state.currentUtterance.onend = () => {
            if (state.highlightedWord) {
                state.highlightedWord.classList.remove('highlight');
                state.highlightedWord = null;
            }
        };
        
        state.currentUtterance.onerror = (event) => {
            if (event.error !== 'canceled' && 
                event.error !== 'interrupted' && 
                event.error !== 'synthesis-cancelled') {
                console.error("Error TTS:", event.error);
                showToast("Error en el lector de audio.", "error");
            }
        };
        
        state.synth.speak(state.currentUtterance);
    };

    const pauseTTS = () => {
        if (state.synth.speaking && !state.synth.paused) {
            state.synth.pause();
        }
    };

    const stopTTS = () => {
        if (state.synth.speaking) {
            state.synth.cancel();
        }
        
        if (state.highlightedWord) {
            state.highlightedWord.classList.remove('highlight');
            state.highlightedWord = null;
        }
    };

    // ====================
    // 4. ASIGNACIÓN DE EVENTOS
    // ====================
    refs.navVocabBtn.onclick = showVocabularyView;
    refs.navReaderBtn.onclick = showReaderView;
    refs.fileInput.onchange = () => handleFile(refs.fileInput.files[0]);
    refs.dropArea.onclick = () => refs.fileInput.click();
    refs.dropArea.ondragover = (e) => {
        e.preventDefault();
        e.currentTarget.classList.add('drag-over');
    };
    refs.dropArea.ondragleave = (e) => {
        e.currentTarget.classList.remove('drag-over');
    };
    refs.dropArea.ondrop = (e) => {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
        handleFile(e.dataTransfer.files[0]);
    };
    refs.prevBtn.onclick = async () => {
        if (state.currentPageIndex > 0) {
            state.currentPageIndex--;
            await updateView();
        }
    };
    refs.nextBtn.onclick = async () => {
        if (state.currentPageIndex < state.documentPages.length - 1) {
            state.currentPageIndex++;
            await updateView();
        }
    };
    refs.restartBtn.onclick = showUploadView;
    refs.vocabStatusFilter.onchange = loadAndRenderVocabulary;
    refs.vocabSearchInput.onkeyup = filterVocabularyTable;
    refs.vocabTableBody.onclick = handleTableActions;
    refs.popupCloseBtn.onclick = hidePopup;
    refs.popupOverlay.onclick = hidePopup;
    refs.popupStatusButtons.onclick = handleStatusChange;
    refs.playBtn.onclick = playTTS;
    refs.pauseBtn.onclick = pauseTTS;
    refs.stopBtn.onclick = stopTTS;

    // --- NUEVO EVENTO PARA EL BOTÓN DE VOZ DEL POPUP ---
    document.getElementById('popup-speak-btn').onclick = () => {
        const wordToSpeak = refs.popupWord.textContent;
        const sourceLang = refs.popupStatusButtons.dataset.currentSourceLang;

        if (wordToSpeak && sourceLang) {
            // Detenemos cualquier audio que se esté reproduciendo
            state.synth.cancel();
            
            const utterance = new SpeechSynthesisUtterance(wordToSpeak);
            utterance.lang = sourceLang;
            state.synth.speak(utterance);
        }
    };

    // ====================
    // 5. INICIALIZACIÓN
    // ====================
    speechSynthesis.onvoiceschanged = populateVoiceList;
    populateVoiceList();
    populateTranslationLanguages();
});