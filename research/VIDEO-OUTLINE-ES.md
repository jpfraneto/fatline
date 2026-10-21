# Tu primer cliente de Farcaster, desde cero

**Promesa editorial:** al terminar, puedes leer y publicar desde tu propio nodo, entender qué estás firmando y cambiar las reglas de tu feed.

Un título posible: **“Construye tu propio cliente de Farcaster: de cero a tu primer cast”**. El bounty es el motivo para empezar, pero el video debe seguir siendo útil cuando termine el concurso.

Duración orientativa: 90–120 minutos, con capítulos. Es una propuesta de guion; todavía no hay grabación ni implementación demostrada.

## 1. Mostrar el resultado antes de explicar la arquitectura — 5 minutos

Abrir dos clientes con la misma cuenta. Publicar desde uno y encontrar el mensaje en el otro. Cambiar un filtro y mostrar cómo cambia la experiencia sin cambiar la identidad.

“Hoy vamos a construir una herramienta que podamos entender y modificar. Vas a ver de dónde sale cada mensaje y qué permiso le das a este cliente.”

Contar brevemente por qué quieres enseñar esto como programador autodidacta. Mostrar la estructura del curso, los requisitos y el costo real medido del servidor. Evitar una introducción larga sobre el precio del premio.

## 2. Qué es un protocolo y qué es un cliente — 10 minutos

Comparar un mensaje y la aplicación que lo presenta. Dibujar la relación entre interfaz, servidor, nodo y red. Explicar qué se comparte entre clientes y qué decisiones toma cada aplicación.

Introducir las palabras cuando hacen falta: terminal, comando, proceso, puerto, servidor, solicitud y respuesta. Usar ejemplos que se ejecutarán después.

Mostrar una petición HTTP y su respuesta JSON. Leer tres campos juntos. Un FID es un número estable; un nombre puede cambiar. Usar FID 37 para una primera consulta pública, sin depender de una credencial de Neynar.

## 3. Crear y observar el nodo — 15 minutos más el tiempo de sincronización

Explicar CPU, memoria, disco y ancho de banda con el servidor concreto. Ejecutar el comando de provisión, revisar qué crea y guardar cómo apagarlo. Explicar Docker como una forma de distribuir un programa con su entorno.

Ejecutar la instalación del nodo. Mostrar snapshot, descarga, estado local y bloques nuevos. Explicar por qué tarda. El video puede condensar la espera, pero debe mostrar el tiempo real transcurrido.

Leer `/v1/info`: versión, shards y retraso. Un contenedor encendido no demuestra que el nodo esté sincronizado. Enseñar qué hacer si el disco se llena, la descarga se corta o faltan peers.

## 4. Construir el primer lector — 15 minutos

Antes de una interfaz completa, imprimir casts de una cuenta. Transformar JSON en una lista y después en tarjetas. Explicar variables, objetos, arrays, funciones, `async/await` y renderizado en el momento de usarlos.

Pasar de una cuenta al feed de seguidos: consultar relaciones, pedir mensajes, unir listas, ordenar y eliminar duplicados. Explicar paginación y por qué una lista grande necesita límites y caché.

Punto de control: el alumno puede cambiar el FID inicial y ver mensajes diferentes. Debe poder señalar la URL del nodo que respondió.

## 5. Entender las llaves antes de publicar — 15 minutos

Separar FID, dirección de custodia, wallet conectada y llave de aplicación. Dibujar la cadena de autorización. Una firma demuestra autorización; no cifra un mensaje público.

Usar una cuenta de desarrollo existente con storage. Explicar por qué no se usa la cuenta principal ni se pega una frase semilla en el chat del agente. Mostrar la herramienta local de autorización sin grabar ninguna frase o llave privada.

Explicar que el registro actual de una app key puede ser gasless. Mostrar scopes, nonce y vencimiento; distinguir esta operación del registro de una cuenta y del pago de storage. Para el ejercicio personal se puede usar el mismo FID como usuario y solicitante; explicar cuándo hace falta una identidad de app separada.

Punto de control: el alumno encuentra su nueva llave pública en el nodo y puede describir qué permite hacer y cómo revocarla.

## 6. Publicar un mensaje y comprobar que llegó — 10 minutos

Construir “Hola mundo desde mi propio cliente”. Mostrar la estructura del mensaje, la firma y el envío. Explicar Protobuf como formato de intercambio sin enseñar criptografía desde cero.

Seguir el recorrido: cliente → nodo propio → gossip → validadores → bloque → nodo propio. El nodo de lectura no vota en consenso, aunque sí acepta y retransmite mensajes.

Mostrar el estado pendiente y la consulta que confirma inclusión. Explicar por qué recibir una respuesta exitosa al envío no basta para afirmar que el cast ya está publicado. Si hay un fallo real, usarlo para enseñar diagnóstico.

## 7. Agregar interacciones y decidir qué se ve — 15 minutos

Implementar seguir/dejar de seguir y like/unlike. Enseñar que son otros tipos de mensajes, firmados con permisos específicos.

Mostrar de dónde sale la identidad de la app que solicitó una llave. Filtrar por ese origen e incluir el caso desconocido. Explicar que esto cambia la vista local y no borra mensajes de la red.

Punto de control: el alumno puede incluir o excluir una app conocida y entender el efecto. No atribuir al protocolo decisiones de ranking que tomó nuestro cliente.

## 8. Pedirle una modificación al agente — 10 minutos

Usar la misma base de código y el mismo proceso verificado de la guía manual. Un ejemplo:

“Quiero un cliente en español, con un feed cronológico, donde pueda elegir qué aplicaciones aparecen. Usa mi nodo existente y conserva las funciones de publicar, seguir y reaccionar.”

Revisar los archivos modificados y ejecutar las comprobaciones. Mostrar que el programa sigue funcionando después de cerrar el agente. La habilidad que queremos enseñar es explicar una intención, revisar el cambio y comprobar su efecto.

## 9. Otra persona lo reproduce — 5 minutos

Mostrar a un alumno real siguiendo la guía en su propio entorno, con su consentimiento. Incluir un problema que encontró y la mejora que provocó. Su testimonio debe describir lo que hizo de verdad.

Terminar con una tarea concreta: cambia una regla del feed, explica tu cambio y comparte el repositorio o un cast publicado desde tu cliente. Mostrar también cómo desconectar la llave y apagar los recursos que generan costo.

## Material que debe acompañar al video

- Tutorial escrito adaptable a celular y escritorio, con quickstart en inglés y recorrido completo en español.
- Capítulos y subtítulos; glosario español/inglés para terminal, endpoint, signer, custody, scope, storage y shard.
- Checkpoints del repositorio en cada resultado visible, todos ejecutables con las mismas versiones documentadas.
- Errores reales y soluciones verificadas, especialmente sincronización, storage, custodia incorrecta y mensajes sin confirmar.
- Una demostración breve de 59 segundos, extraída del resultado real después de terminar la guía.

El criterio de edición: cada concepto nuevo debe ayudar a entender la siguiente acción. El código generado debe pasar por revisión humana. No llamar “fácil” a un paso que todavía no haya completado otra persona sin nuestra intervención.
