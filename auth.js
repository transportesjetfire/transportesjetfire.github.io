/**
 * auth.js - Gestión de Autenticación de Usuarios con Firebase Auth
 */
import {
    auth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    sendPasswordResetEmail,
    updateProfile
} from "./firebase.js";
import { showToast, showLoader, hideLoader } from "./ui.js";

// Inicializar módulo de Auth y vincular listeners
export function initAuth(onUserAuthenticated, onUserLoggedOut) {
    const authScreen = document.getElementById('auth-screen');
    const appShell = document.getElementById('app-shell');
    const authForm = document.getElementById('auth-form');
    const authEmail = document.getElementById('auth-email');
    const authPassword = document.getElementById('auth-password');
    const authSubmitBtn = document.getElementById('auth-submit-btn');
    const authSwitchBtn = document.getElementById('auth-switch-btn');
    const authSwitchText = document.getElementById('auth-switch-text');
    const authTitle = document.getElementById('auth-title');
    const authSubtitle = document.getElementById('auth-subtitle');
    const nameFieldContainer = document.getElementById('name-field-container');
    const registerName = document.getElementById('register-name');
    const forgotPasswordBtn = document.getElementById('forgot-password-btn');

    let isRegisterMode = false;

    // Observar estado de autenticación
    onAuthStateChanged(auth, (user) => {
        if (user) {
            // Sesión iniciada
            authScreen.classList.add('hidden');
            appShell.classList.remove('hidden');
            
            // Actualizar datos del perfil en la UI
            updateProfileUI(user);

            if (onUserAuthenticated) {
                onUserAuthenticated(user);
            }
        } else {
            // Sin sesión activa - Ocultar cargador para mostrar el formulario
            hideLoader();
            appShell.classList.add('hidden');
            authScreen.classList.remove('hidden');
            
            if (onUserLoggedOut) {
                onUserLoggedOut();
            }
        }
    });

    // Alternar modo Login / Registro
    authSwitchBtn.addEventListener('click', () => {
        isRegisterMode = !isRegisterMode;
        
        if (isRegisterMode) {
            authTitle.textContent = "Crea tu cuenta";
            authSubtitle.textContent = "Empieza a organizar tus días con estilo";
            authSubmitBtn.querySelector('span').textContent = "Registrarse";
            authSwitchText.innerHTML = `¿Ya tienes cuenta? <button id="auth-switch-btn" class="btn-link-highlight">Inicia Sesión</button>`;
            nameFieldContainer.classList.remove('hidden');
            registerName.required = true;
            forgotPasswordBtn.classList.add('hidden');
        } else {
            authTitle.textContent = "Mi Agenda";
            authSubtitle.textContent = "Organiza tu día de forma sencilla";
            authSubmitBtn.querySelector('span').textContent = "Iniciar Sesión";
            authSwitchText.innerHTML = `¿No tienes cuenta? <button id="auth-switch-btn" class="btn-link-highlight">Regístrate</button>`;
            nameFieldContainer.classList.add('hidden');
            registerName.required = false;
            forgotPasswordBtn.classList.remove('hidden');
        }

        // Re-vincular event listener para el nuevo botón del switch text generado dinámicamente
        document.getElementById('auth-switch-btn').addEventListener('click', () => {
            authSwitchBtn.click();
        });
    });

    // Envío del formulario (Login / Registro)
    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = authEmail.value.trim();
        const password = authPassword.value;
        
        const btnLoader = authSubmitBtn.querySelector('.btn-loader');
        const btnText = authSubmitBtn.querySelector('span');

        // Mostrar spinner en el botón
        btnLoader.classList.remove('hidden');
        btnText.classList.add('hidden');
        authSubmitBtn.disabled = true;

        try {
            if (isRegisterMode) {
                const name = registerName.value.trim();
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                
                // Actualizar el perfil del usuario con su nombre
                await updateProfile(userCredential.user, {
                    displayName: name
                });
                
                showToast("¡Cuenta creada con éxito!", "success");
            } else {
                await signInWithEmailAndPassword(auth, email, password);
                showToast("¡Sesión iniciada correctamente!", "success");
            }
        } catch (error) {
            console.error("Error en autenticación:", error);
            let userFriendlyMsg = "Ocurrió un error en la autenticación.";
            
            switch (error.code) {
                case 'auth/invalid-email':
                    userFriendlyMsg = "El correo electrónico no es válido.";
                    break;
                case 'auth/user-disabled':
                    userFriendlyMsg = "Este usuario ha sido deshabilitado.";
                    break;
                case 'auth/user-not-found':
                case 'auth/wrong-password':
                case 'auth/invalid-credential':
                    userFriendlyMsg = "Credenciales incorrectas. Verifica tu correo y contraseña.";
                    break;
                case 'auth/email-already-in-use':
                    userFriendlyMsg = "Este correo electrónico ya está registrado.";
                    break;
                case 'auth/weak-password':
                    userFriendlyMsg = "La contraseña debe tener al menos 6 caracteres.";
                    break;
            }
            showToast(userFriendlyMsg, "error");
        } finally {
            btnLoader.classList.add('hidden');
            btnText.classList.remove('hidden');
            authSubmitBtn.disabled = false;
        }
    });

    // Recuperación de Contraseña
    forgotPasswordBtn.addEventListener('click', async () => {
        const email = authEmail.value.trim();
        if (!email) {
            showToast("Ingresa tu correo en el campo correspondiente para reestablecer tu contraseña.", "info");
            authEmail.focus();
            return;
        }

        showLoader();
        try {
            await sendPasswordResetEmail(auth, email);
            showToast("Se ha enviado un correo para restablecer tu contraseña.", "success");
        } catch (error) {
            console.error("Error en recuperación:", error);
            showToast("No se pudo enviar el correo de recuperación. Revisa la dirección ingresada.", "error");
        } finally {
            hideLoader();
        }
    });

    // Eventos de cierre de sesión
    const logoutAction = async () => {
        showLoader();
        try {
            await signOut(auth);
            showToast("Sesión cerrada", "info");
        } catch (error) {
            console.error("Error al cerrar sesión:", error);
            showToast("Error al cerrar sesión", "error");
            hideLoader();
        }
    };

    document.getElementById('btn-logout').addEventListener('click', logoutAction);
    document.getElementById('drawer-btn-logout').addEventListener('click', logoutAction);
}

// Actualizar UI del perfil
function updateProfileUI(user) {
    const name = user.displayName || "Usuario";
    const email = user.email || "sin_correo@ejemplo.com";
    const initial = name.charAt(0).toUpperCase();

    // Elementos de pantalla Perfil
    const pName = document.getElementById('profile-name');
    const pEmail = document.getElementById('profile-email');
    const pAvatar = document.getElementById('profile-avatar');

    if (pName) pName.textContent = name;
    if (pEmail) pEmail.textContent = email;
    if (pAvatar) pAvatar.textContent = initial;

    // Elementos de Sidebar Drawer
    const dName = document.getElementById('drawer-user-name');
    const dEmail = document.getElementById('drawer-user-email');
    const dAvatar = document.getElementById('drawer-avatar');

    if (dName) dName.textContent = name;
    if (dEmail) dEmail.textContent = email;
    if (dAvatar) dAvatar.textContent = initial;
}
