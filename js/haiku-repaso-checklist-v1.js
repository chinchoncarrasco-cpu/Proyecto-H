// Lista de Repaso acordada con Operación. Comparte orden y claves con Mobile.
(function (root) {
    const profile = {
    "version": 1,
    "sections": [
        {
            "id": "living",
            "title": "🛏️ LIVING / CAMA",
            "category": "REPASO · LIVING / CAMA",
            "items": [
                {
                    "id": "repaso-living-cama",
                    "label": "Cama"
                },
                {
                    "id": "repaso-living-cajones",
                    "label": "Cajones"
                },
                {
                    "id": "repaso-living-lamparas",
                    "label": "Lámparas"
                },
                {
                    "id": "repaso-living-controles",
                    "label": "Controles"
                },
                {
                    "id": "repaso-living-tv",
                    "label": "TV"
                },
                {
                    "id": "repaso-living-ac",
                    "label": "AC"
                },
                {
                    "id": "repaso-living-luces",
                    "label": "Luces"
                },
                {
                    "id": "repaso-living-salamandra",
                    "label": "Salamandra"
                },
                {
                    "id": "repaso-living-manilla",
                    "label": "Manilla"
                },
                {
                    "id": "repaso-living-piso",
                    "label": "Piso"
                }
            ]
        },
        {
            "id": "kitchen",
            "title": "🍳 COCINA",
            "category": "REPASO · COCINA",
            "items": [
                {
                    "id": "repaso-kitchen-perillas",
                    "label": "Perillas"
                },
                {
                    "id": "repaso-kitchen-llave-gas",
                    "label": "Llave de gas"
                },
                {
                    "id": "repaso-kitchen-implementos",
                    "label": "Implementos"
                },
                {
                    "id": "repaso-kitchen-refri",
                    "label": "Refri"
                }
            ]
        },
        {
            "id": "bathroom",
            "title": "🚿 BAÑO",
            "category": "REPASO · BAÑO",
            "items": [
                {
                    "id": "repaso-bathroom-amenities",
                    "label": "Amenities"
                },
                {
                    "id": "repaso-bathroom-wc",
                    "label": "WC"
                },
                {
                    "id": "repaso-bathroom-papel-h",
                    "label": "P.H."
                },
                {
                    "id": "repaso-bathroom-toallas",
                    "label": "Toallas"
                },
                {
                    "id": "repaso-bathroom-basurero",
                    "label": "Basurero"
                },
                {
                    "id": "repaso-bathroom-ducha",
                    "label": "Ducha"
                },
                {
                    "id": "repaso-bathroom-piso",
                    "label": "Piso"
                }
            ]
        },
        {
            "id": "terrace",
            "title": "🌄 TERRAZA",
            "category": "REPASO · TERRAZA",
            "items": [
                {
                    "id": "repaso-terrace-fogon",
                    "label": "Fogón"
                },
                {
                    "id": "repaso-terrace-atizador",
                    "label": "Atizador"
                },
                {
                    "id": "repaso-terrace-jardineras",
                    "label": "Jardineras"
                },
                {
                    "id": "repaso-terrace-cojines",
                    "label": "Cojines"
                },
                {
                    "id": "repaso-terrace-piso",
                    "label": "Piso"
                }
            ]
        }
    ]
};
    if (typeof module === "object" && module.exports) module.exports = profile;
    if (root) root.HAIKU_REPASO_CHECKLIST_V1 = profile;
})(typeof window !== "undefined" ? window : null);
